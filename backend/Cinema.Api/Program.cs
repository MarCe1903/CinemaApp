using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Cinema.Api;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false).AddEnvironmentVariables().AddCommandLine(args);
builder.Services.AddDbContext<CinemaDb>(options => options.UseSqlServer(
    builder.Configuration.GetConnectionString("Cinema") ?? throw new InvalidOperationException("Cinema bağlantı dizesi eksik.")));
builder.Services.AddIdentityCore<AppUser>(options => {
    options.User.RequireUniqueEmail = true;
    options.Password.RequiredLength = 8;
    options.Lockout.MaxFailedAccessAttempts = 5;
}).AddRoles<IdentityRole>().AddEntityFrameworkStores<CinemaDb>().AddSignInManager();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddCookie(IdentityConstants.ApplicationScheme, options => {
    options.Cookie.Name = "Cinema.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    options.Events.OnValidatePrincipal = AccessControl.ValidateSession;
});
builder.Services.AddAuthorization(options => {
    options.AddPolicy("ManageContent", policy => policy.RequireRole(AccessControl.Manager, AccessControl.Admin));
    options.AddPolicy("AdminOnly", policy => policy.RequireRole(AccessControl.Admin));
});
builder.Services.AddProblemDetails();
var app = builder.Build();
TicketPdf.Initialize();
app.UseExceptionHandler();
app.Use(async (context, next) => {
    // A custom header and no CORS policy prevent cross-site cookie mutations.
    if (HttpMethods.IsPost(context.Request.Method) && context.Request.Headers["X-Cinema-Request"] != "1") {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsJsonAsync(new { message = "Geçersiz istek." });
        return;
    }
    await next();
});
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", features = new[] { "movie-posters" } }));
app.MapPost("/api/auth/register", async (RegisterRequest request, UserManager<AppUser> users, SignInManager<AppUser> signIn) => {
    if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 80 ||
        string.IsNullOrWhiteSpace(request.Email) || request.Email.Length > 254 ||
        !System.Net.Mail.MailAddress.TryCreate(request.Email, out _) || string.IsNullOrEmpty(request.Password) || request.Password.Length > 128)
        return Results.BadRequest(new { message = "Geçerli bir ad, e-posta ve şifre girin." });
    var user = new AppUser { DisplayName = request.Name.Trim(), UserName = request.Email.Trim(), Email = request.Email.Trim() };
    var result = await users.CreateAsync(user, request.Password);
    if (!result.Succeeded) return Results.BadRequest(new { message = "Hesap oluşturulamadı. E-posta kullanılıyor olabilir; şifre en az 8 karakter, büyük/küçük harf, rakam ve özel karakter içermelidir." });
    AccessControl.Ensure(await users.AddToRoleAsync(user, AccessControl.Member));
    await signIn.SignInAsync(user, false);
    return Results.Ok(await AccessControl.Profile(user, users));
});
app.MapPost("/api/auth/login", async (LoginRequest request, UserManager<AppUser> users, SignInManager<AppUser> signIn) => {
    if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        return Results.BadRequest(new { message = "E-posta ve şifrenizi girin." });
    var user = await users.FindByEmailAsync(request.Email.Trim()) ?? await users.FindByNameAsync(request.Email.Trim());
    if (user is null) return Results.Json(new { message = "E-posta veya şifre hatalı." }, statusCode: 401);
    var result = await signIn.PasswordSignInAsync(user, request.Password, false, lockoutOnFailure: true);
    if (!result.Succeeded) return Results.Json(new { message = result.IsLockedOut ? "Çok fazla deneme. Birkaç dakika sonra tekrar deneyin." : "E-posta veya şifre hatalı." }, statusCode: 401);
    return Results.Ok(await AccessControl.Profile(user, users));
});
app.MapPost("/api/auth/logout", async (SignInManager<AppUser> signIn) => { await signIn.SignOutAsync(); return Results.NoContent(); }).RequireAuthorization();
app.MapGet("/api/auth/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) => {
    var user = await users.GetUserAsync(principal);
    return user is null ? Results.Unauthorized() : Results.Ok(await AccessControl.Profile(user, users));
}).RequireAuthorization();
app.MapGet("/api/movies", async (CinemaDb db) => await MoviePosters.Catalog(db).ToListAsync());
app.MapGet("/api/movies/{id:int}/poster", async (int id, HttpContext context, CinemaDb db) => {
    var poster = await db.MoviePosters.AsNoTracking().SingleOrDefaultAsync(p => p.MovieId == id);
    if (poster is null) return Results.NotFound();
    context.Response.Headers.CacheControl = "no-cache";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    return Results.File(poster.Data, "image/png", entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{poster.Version}\""));
});
app.MapGet("/api/movies/{id:int}/screenings", async (int id, CinemaDb db) =>
    await db.Screenings.AsNoTracking().Where(x => x.MovieId == id && x.StartsAt > DateTimeOffset.UtcNow)
        .OrderBy(x => x.StartsAt).Select(x => new { x.Id, x.StartsAt, x.Price, x.Hall, x.Format }).ToListAsync());
app.MapGet("/api/screenings/{id:int}/seats", async (int id, CinemaDb db) => {
    if (!await db.Screenings.AnyAsync(x => x.Id == id)) return Results.NotFound();
    var occupied = await db.BookingSeats.Where(x => x.ScreeningId == id).Select(x => x.Seat).ToListAsync();
    var inventory = await db.ScreeningSeats.Where(x => x.ScreeningId == id).Select(x => x.Seat).ToListAsync();
    return Results.Ok(new { rows = string.Concat(inventory.Select(x => x[0]).Distinct().Order()),
        columns = inventory.Count == 0 ? 0 : inventory.Max(x => int.Parse(x[1..])), occupied });
});
app.MapGet("/api/bookings", async (ClaimsPrincipal principal, CinemaDb db) => {
    var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    return await db.Bookings.AsNoTracking().Where(x => x.UserId == userId).OrderByDescending(x => x.CreatedAt)
        .Select(x => new { x.Id, x.Code, x.Total, x.CreatedAt, movieTitle = x.Screening.Movie.Title,
            x.Screening.StartsAt, x.Screening.Hall, x.Screening.Format, seats = x.Seats.Select(s => s.Seat).ToArray() }).ToListAsync();
}).RequireAuthorization();
app.MapPost("/api/bookings", async (BookingRequest request, HttpContext context, CinemaDb db) => {
    var paymentError = PaymentValidation.Error(request.Payment);
    if (paymentError is not null) return Results.BadRequest(new { message = paymentError });
    var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (userId is null && (string.IsNullOrWhiteSpace(request.ContactName) || request.ContactName.Trim().Length is < 2 or > 80 ||
        string.IsNullOrWhiteSpace(request.ContactEmail) || request.ContactEmail.Length > 254 || !System.Net.Mail.MailAddress.TryCreate(request.ContactEmail, out _)))
        return Results.BadRequest(new { message = "Misafir bileti için ad soyad ve geçerli bir e-posta girin." });
    if (request.Seats is null || request.Seats.Length is < 1 or > 8 || request.Seats.Distinct().Count() != request.Seats.Length ||
        request.Seats.Any(x => x is null || !System.Text.RegularExpressions.Regex.IsMatch(x, "^[A-H]([1-9]|1[0-2])$")))
        return Results.BadRequest(new { message = "En fazla 8 geçerli ve farklı koltuk seçin." });
    await using var transaction = await db.Database.BeginTransactionAsync();
    await AdminEndpoints.LockSchedule(db);
    var screening = await db.Screenings.FindAsync(request.ScreeningId);
    if (screening is null || screening.StartsAt <= DateTimeOffset.UtcNow)
        return Results.BadRequest(new { message = "Bu seans artık satışa açık değil." });
    if (await db.ScreeningSeats.CountAsync(x => x.ScreeningId == screening.Id && request.Seats.Contains(x.Seat)) != request.Seats.Length)
        return Results.BadRequest(new { message = "Seçilen koltuklar bu salonda bulunmuyor." });
    var guestToken = userId is null ? Convert.ToHexString(RandomNumberGenerator.GetBytes(32)) : null;
    var booking = new Booking {
        UserId = userId, ScreeningId = screening.Id,
        ContactName = userId is null ? request.ContactName!.Trim() : null,
        ContactEmail = userId is null ? request.ContactEmail!.Trim() : null,
        GuestAccessHash = guestToken is null ? null : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(guestToken))),
        Total = screening.Price * request.Seats.Length,
        Seats = request.Seats.Select(seat => new BookingSeat { ScreeningId = screening.Id, Seat = seat }).ToList()
    };
    db.Bookings.Add(booking);
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 }) {
        return Results.Conflict(new { message = "Seçtiğiniz koltuklardan biri az önce alındı. Güncel plandan yeniden seçim yapın." });
    }
    await transaction.CommitAsync();
    if (guestToken is not null) context.Response.Cookies.Append($"Cinema.Guest.{booking.Id:N}", guestToken,
        new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = !app.Environment.IsDevelopment(),
            Path = $"/api/bookings/{booking.Id}", MaxAge = TimeSpan.FromDays(7) });
    return Results.Ok(new { booking.Id, booking.Code, booking.Total, isGuest = userId is null });
});
app.MapGet("/api/bookings/{id:guid}/pdf", async (Guid id, HttpContext context, CinemaDb db) => {
    var booking = await db.Bookings.AsNoTracking().Include(x => x.Seats).Include(x => x.Screening).ThenInclude(x => x.Movie)
        .SingleOrDefaultAsync(x => x.Id == id);
    if (booking is null) return Results.NotFound();
    var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    var allowed = context.User.IsInRole(AccessControl.Admin) || (booking.UserId is not null && booking.UserId == userId);
    if (!allowed && booking.UserId is null && booking.GuestAccessHash is not null && context.Request.Cookies.TryGetValue($"Cinema.Guest.{id:N}", out var token))
        allowed = CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(token)), Convert.FromHexString(booking.GuestAccessHash));
    if (!allowed) return Results.NotFound();
    context.Response.Headers.CacheControl = "no-store";
    return Results.File(TicketPdf.Create(booking), "application/pdf", $"Cinema-{booking.Code}.pdf");
});
app.MapAdminEndpoints();
app.MapFallbackToFile("index.html");
if (app.Environment.IsDevelopment()) {
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<CinemaDb>();
    await db.Database.EnsureCreatedAsync();
    await MoviePosters.Initialize(db);
    if (builder.Configuration.GetValue<bool>("import-localdb")) { await LocalDbImport.Run(db); return; }
    await SeedData.Initialize(db);
    await AccessControl.Initialize(scope.ServiceProvider, development: true, configuration: builder.Configuration);
}
app.Run();

record RegisterRequest(string Name, string Email, string Password);
record LoginRequest(string Email, string Password);
record BookingRequest(int ScreeningId, string[]? Seats, DemoPayment? Payment, string? ContactName, string? ContactEmail);
