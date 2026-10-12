using Microsoft.EntityFrameworkCore;
namespace Cinema.Api;
public static class SeedData {
    public static async Task Initialize(CinemaDb db) {
        if (await db.Movies.AnyAsync()) { await InitializeSeats(db); return; }
        if (!await db.Movies.AnyAsync()) {
            db.Movies.AddRange(
                new Movie { Title = "Yıldızların Ötesinde", Tagline = "Bazı yolculuklar eve dönmek için başlar.", Description = "Dünyadan gelen son sinyalin ardından genç bir astronot, unutulmuş bir gezegende insanlığın geleceğini arar. Zamanın ve mesafelerin ötesinde, umut üzerine büyüleyici bir yolculuk.", Genre = "Bilim Kurgu", Art = "cosmos", Duration = 148, Age = "13+", Rating = 8.7m, Director = "Deniz Arman" },
                new Movie { Title = "Son Işık", Tagline = "Her karanlığın bir hikâyesi var.", Description = "Uykusuz bir şehrin sokaklarında kesişen üç yabancının hayatı, tek bir gecede sonsuza dek değişir.", Genre = "Gerilim", Art = "city", Duration = 116, Age = "16+", Rating = 8.2m, Director = "Ece Demir" },
                new Movie { Title = "Bir Yaz Daha", Tagline = "En güzel anlar plansız gelir.", Description = "Yıllar sonra sahil kasabasına dönen iki çocukluk arkadaşı, eski bir sinemayı yeniden açmak için unutulmaz bir yaza adım atar.", Genre = "Romantik", Art = "summer", Duration = 104, Age = "7+", Rating = 7.9m, Director = "Can Yılmaz" },
                new Movie { Title = "Kayıp Orman", Tagline = "Küçük bir adım, kocaman bir macera.", Description = "Meraklı bir tilki ve korkusuz arkadaşları, ormanın kaybolan renklerini bulmak için büyülü bir yolculuğa çıkar.", Genre = "Animasyon", Art = "forest", Duration = 92, Age = "Genel", Rating = 8.5m, Director = "Selin Kaya" },
                new Movie { Title = "Sıfır Noktası", Tagline = "Geri sayım başladı.", Description = "Bir kurtarma pilotu, zamana karşı yarışırken hiç beklemediği bir görevin tam ortasında kalır.", Genre = "Aksiyon", Art = "fire", Duration = 128, Age = "13+", Rating = 8.1m, Director = "Mert Aydın" },
                new Movie { Title = "Hayatın Ritmi", Tagline = "Kendi sesini bul.", Description = "Genç bir müzisyen, küçük bir caz kulübünde kurduğu dostluklar sayesinde hayallerine yeniden inanmayı öğrenir.", Genre = "Dram", Art = "rhythm", Duration = 112, Age = "7+", Rating = 8.4m, Director = "Ada Ergin" });
            await db.SaveChangesAsync();
        }
        var today = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3)).Date;
        foreach (var movie in await db.Movies.ToListAsync()) {
            for (var day = 0; day < 7; day++) {
                foreach (var hour in new[] { 12, 15, 18, 21 }) {
                    var time = new DateTimeOffset(today.AddDays(day).AddHours(hour), TimeSpan.FromHours(3));
                    if (await db.Screenings.AnyAsync(x => x.MovieId == movie.Id && x.StartsAt == time)) continue;
                    db.Screenings.Add(new Screening { MovieId = movie.Id, StartsAt = time, Hall = $"Salon {movie.Id}", Format = movie.Id == 1 ? "IMAX · Altyazılı" : "2D · Türkçe", Price = movie.Id == 1 ? 320 : 240 });
                }
            }
        }
        await db.SaveChangesAsync();
        await InitializeSeats(db);
    }
    public static Task InitializeSeats(CinemaDb db) => db.Database.ExecuteSqlRawAsync("""
        INSERT INTO ScreeningSeats (ScreeningId, Seat)
        SELECT s.Id, r.Label + CAST(n.Num AS varchar(2)) FROM Screenings s
        CROSS JOIN (VALUES ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H')) r(Label)
        CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) n(Num)
        WHERE NOT EXISTS (SELECT 1 FROM ScreeningSeats inventory
            WHERE inventory.ScreeningId = s.Id AND inventory.Seat = r.Label + CAST(n.Num AS varchar(2)))
        """);
}
