using System.Data;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Cinema.Api;

public static class AdminEndpoints {
    private static readonly HashSet<string> Arts = ["cosmos", "city", "summer", "forest", "fire", "rhythm"];

    public static void MapAdminEndpoints(this WebApplication app) {
        var content = app.MapGroup("/api/manage").RequireAuthorization("ManageContent");
        content.MapGet("/movies", async (CinemaDb db) => await MoviePosters.Catalog(db).ToListAsync());
        content.MapPost("/movies", async (MovieInput input, CinemaDb db) => {
            if (MovieError(input) is { } error) return Results.BadRequest(new { message = error });
            if (MoviePosters.Decode(input.PosterPng, input.RemovePoster, out var png) is { } pngError) return Results.BadRequest(new { message = pngError });
            await using var transaction = await db.Database.BeginTransactionAsync();
            var movie = new Movie();
            Apply(movie, input); db.Movies.Add(movie); await db.SaveChangesAsync();
            await MoviePosters.Apply(db, movie.Id, png, input.RemovePoster); await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(movie);
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(8 * 1024 * 1024));
        content.MapPost("/movies/{id:int}", async (int id, MovieInput input, CinemaDb db) => {
            if (MovieError(input) is { } error) return Results.BadRequest(new { message = error });
            if (MoviePosters.Decode(input.PosterPng, input.RemovePoster, out var png) is { } pngError) return Results.BadRequest(new { message = pngError });
            await using var transaction = await db.Database.BeginTransactionAsync();
            await LockSchedule(db);
            var movie = await db.Movies.FindAsync(id);
            if (movie is null) return Results.NotFound();
            var durationChanged = movie.Duration != input.Duration;
            Apply(movie, input);
            var future = durationChanged ? await db.Screenings.Where(s => s.MovieId == id && s.StartsAt > DateTimeOffset.UtcNow).ToListAsync() : [];
            foreach (var screening in future)
                if (await ScreeningError(new ScreeningInput(id, screening.StartsAt, screening.Price, screening.Hall, screening.Format), screening.Id, db) is { } conflict)
                    return Results.Conflict(new { message = conflict });
            await MoviePosters.Apply(db, id, png, input.RemovePoster);
            await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.Ok(movie);
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(8 * 1024 * 1024));
        content.MapPost("/movies/{id:int}/delete", async (int id, CinemaDb db) => {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await LockSchedule(db);
            var movie = await db.Movies.FindAsync(id);
            if (movie is null) return Results.NotFound();
            if (await db.Bookings.AnyAsync(x => x.Screening.MovieId == id))
                return Results.Conflict(new { message = "Bileti satılmış film silinemez; geçmiş biletler korunur." });
            db.Movies.Remove(movie); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.NoContent();
        });
        content.MapGet("/screenings", async (CinemaDb db) => await db.Screenings.AsNoTracking()
            .OrderByDescending(x => x.StartsAt).Select(x => new { x.Id, x.MovieId, movieTitle = x.Movie.Title,
                x.StartsAt, x.Price, x.Hall, x.Format, soldSeats = db.BookingSeats.Count(seat => seat.ScreeningId == x.Id) }).ToListAsync());
        content.MapPost("/screenings", async (ScreeningInput input, CinemaDb db) => {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await LockSchedule(db);
            if (await ScreeningError(input, null, db) is { } error) return Results.BadRequest(new { message = error });
            var screening = new Screening(); Apply(screening, input);
            db.Screenings.Add(screening); await db.SaveChangesAsync();
            foreach (var row in "ABCDEFGH") foreach (var column in Enumerable.Range(1, 12))
                db.ScreeningSeats.Add(new ScreeningSeat { ScreeningId = screening.Id, Seat = $"{row}{column}" });
            await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.Ok(new { screening.Id });
        });
        content.MapPost("/screenings/{id:int}", async (int id, ScreeningInput input, CinemaDb db) => {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await LockSchedule(db);
            var screening = await db.Screenings.FindAsync(id);
            if (screening is null) return Results.NotFound();
            if (await db.Bookings.AnyAsync(x => x.ScreeningId == id))
                return Results.Conflict(new { message = "Bileti satılmış seans değiştirilemez." });
            if (await ScreeningError(input, id, db) is { } error) return Results.BadRequest(new { message = error });
            Apply(screening, input); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.Ok(new { screening.Id });
        });
        content.MapPost("/screenings/{id:int}/delete", async (int id, CinemaDb db) => {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await LockSchedule(db);
            var screening = await db.Screenings.FindAsync(id);
            if (screening is null) return Results.NotFound();
            if (await db.Bookings.AnyAsync(x => x.ScreeningId == id))
                return Results.Conflict(new { message = "Bileti satılmış seans silinemez." });
            db.Screenings.Remove(screening); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.NoContent();
        });

        var admin = app.MapGroup("/api/admin").RequireAuthorization("AdminOnly");
        admin.MapGet("/users", async (CinemaDb db) => await db.Users.AsNoTracking().OrderBy(x => x.DisplayName)
            .Select(user => new { user.Id, user.DisplayName, user.UserName, user.Email,
                roles = db.UserRoles.Where(x => x.UserId == user.Id).Join(db.Roles, link => link.RoleId, role => role.Id, (link, role) => role.Name).ToArray(),
                bookingCount = db.Bookings.Count(x => x.UserId == user.Id) }).ToListAsync());
        admin.MapPost("/users/{id}/role", async (string id, RoleInput input, ClaimsPrincipal principal, CinemaDb db, UserManager<AppUser> users) => {
            if (!RolesContain(input.Role)) return Results.BadRequest(new { message = "Geçerli roller: Member, Manager, Admin." });
            if (id == principal.FindFirstValue(ClaimTypes.NameIdentifier))
                return Results.BadRequest(new { message = "Kendi rolünü değiştiremezsin; başka bir admin düzenleyebilir." });
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await db.Database.ExecuteSqlRawAsync("DECLARE @r int; EXEC @r=sp_getapplock @Resource='Cinema.RoleChanges', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; IF @r<0 THROW 51000, 'Role lock unavailable', 1;");
            var caller = await users.GetUserAsync(principal);
            if (caller is null || !await users.IsInRoleAsync(caller, AccessControl.Admin)) return Results.Forbid();
            var user = await users.FindByIdAsync(id);
            if (user is null) return Results.NotFound();
            var current = await users.GetRolesAsync(user);
            if (current.Contains(AccessControl.Admin) && input.Role != AccessControl.Admin &&
                await db.UserRoles.Join(db.Roles.Where(x => x.Name == AccessControl.Admin), link => link.RoleId, role => role.Id, (link, role) => link.UserId).CountAsync() <= 1)
                return Results.Conflict(new { message = "Son adminin yetkisi kaldırılamaz." });
            AccessControl.Ensure(await users.RemoveFromRolesAsync(user, current));
            AccessControl.Ensure(await users.AddToRoleAsync(user, input.Role));
            await transaction.CommitAsync();
            return Results.Ok(await AccessControl.Profile(user, users));
        });
        admin.MapGet("/bookings", async (CinemaDb db) => await db.Bookings.AsNoTracking().OrderByDescending(x => x.CreatedAt)
            .Select(x => new { x.Id, x.Code, x.Total, x.CreatedAt, movieTitle = x.Screening.Movie.Title, x.Screening.StartsAt, x.Screening.Hall,
                buyerName = x.User != null ? x.User.DisplayName : x.ContactName, buyerEmail = x.User != null ? x.User.Email : x.ContactEmail,
                isGuest = x.UserId == null, seats = x.Seats.Select(s => s.Seat).ToArray() }).ToListAsync());
    }

    private static bool RolesContain(string? role) => role is not null && AccessControl.Roles.Contains(role);
    internal static Task LockSchedule(CinemaDb db) => db.Database.ExecuteSqlRawAsync(
        "DECLARE @r int; EXEC @r=sp_getapplock @Resource='Cinema.ScheduleChanges', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; IF @r<0 THROW 51000, 'Schedule lock unavailable', 1;");
    private static string? MovieError(MovieInput x) {
        if (string.IsNullOrWhiteSpace(x.Title) || x.Title.Trim().Length > 160 ||
            string.IsNullOrWhiteSpace(x.Description) || x.Description.Length > 4000 ||
            string.IsNullOrWhiteSpace(x.Genre) || x.Genre.Length > 50 ||
            string.IsNullOrWhiteSpace(x.Director) || x.Director.Length > 100 ||
            string.IsNullOrWhiteSpace(x.Tagline) || x.Tagline.Length > 200)
            return "Film adı, açıklama, tür, yönetmen ve kısa açıklamayı geçerli uzunlukta doldurun.";
        if (x.Duration is < 1 or > 600 || x.Rating is < 0 or > 10 || !Arts.Contains(x.Art ?? "") || !new[] { "Genel", "7+", "13+", "16+", "18+" }.Contains(x.Age))
            return "Süre (1-600), puan (0-10), yaş sınırı ve afiş temasını kontrol edin.";
        return null;
    }
    private static void Apply(Movie movie, MovieInput x) {
        movie.Title = x.Title.Trim(); movie.Tagline = x.Tagline.Trim(); movie.Description = x.Description.Trim();
        movie.Genre = x.Genre.Trim(); movie.Director = x.Director.Trim(); movie.Art = x.Art;
        movie.Age = x.Age; movie.Duration = x.Duration; movie.Rating = x.Rating;
    }
    private static void Apply(Screening screening, ScreeningInput x) {
        screening.MovieId = x.MovieId; screening.StartsAt = x.StartsAt; screening.Price = x.Price;
        screening.Hall = x.Hall.Trim(); screening.Format = x.Format.Trim();
    }
    private static async Task<string?> ScreeningError(ScreeningInput x, int? excludedId, CinemaDb db) {
        if (x.StartsAt <= DateTimeOffset.UtcNow || x.Price is <= 0 or > 10000 ||
            !Enumerable.Range(1, 6).Select(i => $"Salon {i}").Contains(x.Hall) || string.IsNullOrWhiteSpace(x.Format) || x.Format.Length > 80)
            return "Gelecekte bir tarih, Salon 1-6, gösterim biçimi ve geçerli fiyat (1-10000 TL) girin.";
        var movie = await db.Movies.FindAsync(x.MovieId);
        if (movie is null) return "Film bulunamadı.";
        var ends = x.StartsAt.AddMinutes(movie.Duration + 15);
        var others = await db.Screenings.Where(s => s.Hall == x.Hall && s.Id != excludedId && s.StartsAt < ends)
            .Select(s => new { s.StartsAt, Duration = s.MovieId == x.MovieId ? movie.Duration : s.Movie.Duration }).ToListAsync();
        if (others.Any(s => s.StartsAt.AddMinutes(s.Duration + 15) > x.StartsAt))
            return "Bu salonda başka bir seansla çakışıyor. Film süresine ek olarak 15 dakika ara bırakın.";
        return null;
    }
}

public record MovieInput(string Title, string Tagline, string Description, string Genre, string Art, int Duration, string Age, decimal Rating, string Director, string? PosterPng = null, bool RemovePoster = false);
public record ScreeningInput(int MovieId, DateTimeOffset StartsAt, decimal Price, string Hall, string Format);
public record RoleInput(string Role);
