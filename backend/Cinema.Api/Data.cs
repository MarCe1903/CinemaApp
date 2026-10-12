using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Cinema.Api;
public class AppUser : IdentityUser { public string DisplayName { get; set; } = ""; }
public class Movie {
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string Description { get; set; } = "";
    public string Genre { get; set; } = "";
    public string Art { get; set; } = "";
    public int Duration { get; set; }
    public string Age { get; set; } = "";
    public decimal Rating { get; set; }
    public string Director { get; set; } = "";
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string? PosterUrl { get; set; }
}
public class MoviePoster {
    public int MovieId { get; set; }
    public byte[] Data { get; set; } = [];
    public Guid Version { get; set; } = Guid.NewGuid();
}
public class Screening {
    public int Id { get; set; }
    public int MovieId { get; set; }
    public Movie Movie { get; set; } = null!;
    public DateTimeOffset StartsAt { get; set; }
    public string Hall { get; set; } = "";
    public string Format { get; set; } = "";
    public decimal Price { get; set; }
}
public class Booking {
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = "CN-" + Guid.NewGuid().ToString("N")[..12].ToUpperInvariant();
    public string? UserId { get; set; }
    public AppUser? User { get; set; }
    public string? ContactName { get; set; }
    public string? ContactEmail { get; set; }
    public string? GuestAccessHash { get; set; }
    public int ScreeningId { get; set; }
    public Screening Screening { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public decimal Total { get; set; }
    public List<BookingSeat> Seats { get; set; } = [];
}
public class BookingSeat {
    public int Id { get; set; }
    public Guid BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public int ScreeningId { get; set; }
    public Screening Screening { get; set; } = null!;
    public string Seat { get; set; } = "";
}
public class ScreeningSeat {
    public int ScreeningId { get; set; }
    public Screening Screening { get; set; } = null!;
    public string Seat { get; set; } = "";
}
public class CinemaDb(DbContextOptions<CinemaDb> options) : IdentityDbContext<AppUser>(options) {
    public DbSet<Movie> Movies => Set<Movie>();
    public DbSet<MoviePoster> MoviePosters => Set<MoviePoster>();
    public DbSet<Screening> Screenings => Set<Screening>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<BookingSeat> BookingSeats => Set<BookingSeat>();
    public DbSet<ScreeningSeat> ScreeningSeats => Set<ScreeningSeat>();
    protected override void OnModelCreating(ModelBuilder model) {
        base.OnModelCreating(model);
        model.Entity<Movie>().Property(x => x.Rating).HasPrecision(3, 1);
        model.Entity<MoviePoster>().HasKey(x => x.MovieId);
        model.Entity<MoviePoster>().HasOne<Movie>().WithOne().HasForeignKey<MoviePoster>(x => x.MovieId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<Screening>().Property(x => x.Price).HasPrecision(10, 2);
        model.Entity<Booking>().Property(x => x.Total).HasPrecision(10, 2);
        model.Entity<Booking>().HasIndex(x => x.Code).IsUnique();
        model.Entity<Booking>().Property(x => x.ContactName).HasMaxLength(80);
        model.Entity<Booking>().Property(x => x.ContactEmail).HasMaxLength(254);
        model.Entity<Booking>().Property(x => x.GuestAccessHash).HasMaxLength(64);
        model.Entity<ScreeningSeat>().HasKey(x => new { x.ScreeningId, x.Seat });
        model.Entity<ScreeningSeat>().Property(x => x.Seat).HasMaxLength(3);
        model.Entity<BookingSeat>().Property(x => x.Seat).HasMaxLength(3);
        model.Entity<BookingSeat>().HasIndex(x => new { x.ScreeningId, x.Seat }).IsUnique();
        model.Entity<BookingSeat>().HasOne(x => x.Screening).WithMany().HasForeignKey(x => x.ScreeningId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<BookingSeat>().HasOne<ScreeningSeat>().WithMany().HasForeignKey(x => new { x.ScreeningId, x.Seat }).OnDelete(DeleteBehavior.Restrict);
    }
}
