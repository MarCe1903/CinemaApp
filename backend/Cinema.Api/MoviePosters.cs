using System.Buffers.Binary;
using Microsoft.EntityFrameworkCore;

namespace Cinema.Api;

public static class MoviePosters {
    public const int MaxBytes = 5 * 1024 * 1024;
    // Separate, additive table: existing movies and generated artwork remain untouched.
    public static Task Initialize(CinemaDb db) => db.Database.ExecuteSqlRawAsync("""
        IF OBJECT_ID(N'dbo.MoviePosters', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MoviePosters (
                MovieId int NOT NULL CONSTRAINT PK_MoviePosters PRIMARY KEY,
                Data varbinary(max) NOT NULL,
                Version uniqueidentifier NOT NULL,
                CONSTRAINT FK_MoviePosters_Movies_MovieId FOREIGN KEY (MovieId) REFERENCES dbo.Movies(Id) ON DELETE CASCADE
            );
        END
        """);

    public static IQueryable<Movie> Catalog(CinemaDb db) => db.Movies.AsNoTracking().OrderBy(m => m.Id).Select(m => new Movie {
        Id = m.Id, Title = m.Title, Tagline = m.Tagline, Description = m.Description,
        Genre = m.Genre, Art = m.Art, Duration = m.Duration, Age = m.Age, Rating = m.Rating, Director = m.Director,
        PosterUrl = db.MoviePosters.Where(p => p.MovieId == m.Id)
            .Select(p => "/api/movies/" + m.Id + "/poster?v=" + p.Version.ToString()).FirstOrDefault()
    });

    public static string? Decode(string? encoded, bool remove, out byte[]? data) {
        data = null;
        if (encoded is null) return null;
        if (remove) return "Afişi kaldırma ve yeni afiş yükleme aynı anda yapılamaz.";
        if (encoded.Length > ((MaxBytes + 2) / 3) * 4) return "PNG dosyası en fazla 5 MB olabilir.";
        try { data = Convert.FromBase64String(encoded); }
        catch (FormatException) { return "Geçerli bir PNG dosyası seçin."; }
        if (data.Length > MaxBytes) return "PNG dosyası en fazla 5 MB olabilir.";
        if (!ValidPng(data)) return "Dosya geçerli bir PNG görseli olmalıdır (en fazla 8000 × 8000 ve 32 milyon piksel).";
        return null;
    }

    private static bool ValidPng(ReadOnlySpan<byte> bytes) {
        ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.Length < 57 || !bytes[..8].SequenceEqual(signature)) return false;
        var offset = 8; var header = false; var pixels = false;
        while (offset <= bytes.Length - 12) {
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset, 4));
            if (length > bytes.Length - offset - 12) return false;
            var size = (int)length;
            var type = bytes.Slice(offset + 4, 4);
            var payload = bytes.Slice(offset + 8, size);
            var expected = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 8 + size, 4));
            uint crc = 0xffffffff;
            foreach (var value in bytes.Slice(offset + 4, size + 4)) {
                crc ^= value;
                for (var i = 0; i < 8; i++) crc = (crc >> 1) ^ ((crc & 1) == 1 ? 0xedb88320u : 0);
            }
            if (~crc != expected) return false;
            if (type.SequenceEqual("IHDR"u8)) {
                if (header || offset != 8 || size != 13) return false;
                var width = BinaryPrimitives.ReadUInt32BigEndian(payload[..4]);
                var height = BinaryPrimitives.ReadUInt32BigEndian(payload.Slice(4, 4));
                if (width is 0 or > 8000 || height is 0 or > 8000 || (ulong)width * height > 32000000) return false;
                var validDepth = payload[9] switch { 0 => payload[8] is 1 or 2 or 4 or 8 or 16, 2 or 4 or 6 => payload[8] is 8 or 16, 3 => payload[8] is 1 or 2 or 4 or 8, _ => false };
                if (!validDepth || payload[10] != 0 || payload[11] != 0 || payload[12] > 1) return false;
                header = true;
            } else if (!header) return false;
            if (type.SequenceEqual("IDAT"u8) && size > 0) pixels = true;
            if (type.SequenceEqual("IEND"u8)) return header && pixels && size == 0 && offset + 12 == bytes.Length;
            offset += size + 12;
        }
        return false;
    }

    public static async Task Apply(CinemaDb db, int movieId, byte[]? data, bool remove) {
        if (data is null && !remove) return;
        var poster = await db.MoviePosters.FindAsync(movieId);
        if (remove) { if (poster is not null) db.MoviePosters.Remove(poster); return; }
        if (poster is null) { poster = new MoviePoster { MovieId = movieId }; db.MoviePosters.Add(poster); }
        poster.Data = data!; poster.Version = Guid.NewGuid();
    }
}
