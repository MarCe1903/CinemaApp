using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Cinema.Api;

// Explicit, one-time copy into an empty Docker database. The source is read-only.
public static class LocalDbImport {
    public static async Task Run(CinemaDb db) {
        if (await db.Users.AnyAsync() || await db.Movies.AnyAsync() || await db.Bookings.AnyAsync())
            throw new InvalidOperationException("Aktarım hedefi boş olmalı; mevcut verilerin üzerine yazılmadı.");
        await using var source = new SqlConnection("Server=(localdb)\\MSSQLLocalDB;Database=CinemaApp;Trusted_Connection=True;TrustServerCertificate=True");
        await source.OpenAsync();
        await db.Database.OpenConnectionAsync();
        var destination = (SqlConnection)db.Database.GetDbConnection();
        await using var transaction = (SqlTransaction)await destination.BeginTransactionAsync();
        var tables = new[] { "AspNetRoles", "AspNetUsers", "AspNetRoleClaims", "AspNetUserClaims", "AspNetUserLogins", "AspNetUserRoles", "AspNetUserTokens", "Movies", "Screenings", "Bookings", "BookingSeats" };
        foreach (var table in tables) {
            if (table == "BookingSeats") {
                await using var inventory = new SqlCommand("""
                    INSERT INTO ScreeningSeats (ScreeningId, Seat)
                    SELECT s.Id, r.Label + CAST(n.Num AS varchar(2)) FROM Screenings s
                    CROSS JOIN (VALUES ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H')) r(Label)
                    CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) n(Num)
                    """, destination, transaction);
                await inventory.ExecuteNonQueryAsync();
            }
            using var adapter = new SqlDataAdapter($"SELECT * FROM [{table}]", source);
            var data = new DataTable();
            adapter.Fill(data);
            using var copy = new SqlBulkCopy(destination, SqlBulkCopyOptions.KeepIdentity | SqlBulkCopyOptions.CheckConstraints, transaction) { DestinationTableName = table };
            foreach (DataColumn column in data.Columns) copy.ColumnMappings.Add(column.ColumnName, column.ColumnName);
            await copy.WriteToServerAsync(data);
            Console.WriteLine($"Aktarıldı: {table} ({data.Rows.Count} kayıt)");
        }
        await transaction.CommitAsync();
        Console.WriteLine("LocalDB aktarımı tamamlandı. Kaynak veritabanı değiştirilmedi.");
    }
}
