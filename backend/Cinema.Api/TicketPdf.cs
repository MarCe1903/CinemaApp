using System.Globalization;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace Cinema.Api;

public static class TicketPdf {
    // Initialized once before serving requests; embedded font works on Windows and Linux.
    public static void Initialize() => GlobalFontSettings.FontResolver = new TicketFontResolver();
    public static byte[] Create(Booking booking) {
        using var document = new PdfDocument();
        document.Info.Title = $"Cinema - {booking.Code}";
        document.Info.Author = "Cinema";
        var page = document.AddPage();
        page.Width = XUnit.FromPoint(595);
        page.Height = XUnit.FromPoint(600);
        using var canvas = XGraphics.FromPdfPage(page);
        var dark = new XSolidBrush(XColor.FromArgb(24, 32, 24));
        var muted = new XSolidBrush(XColor.FromArgb(100, 112, 96));
        var accent = new XSolidBrush(XColor.FromArgb(213, 246, 107));
        var regular = new XFont("Cinema", 12);
        var small = new XFont("Cinema", 10);
        var heading = new XFont("Cinema", 24, XFontStyleEx.Bold);
        var culture = CultureInfo.GetCultureInfo("tr-TR");
        var starts = booking.Screening.StartsAt.ToOffset(TimeSpan.FromHours(3));
        canvas.DrawRectangle(new XSolidBrush(XColor.FromArgb(248, 249, 245)), 0, 0, 595, 600);
        canvas.DrawRectangle(dark, 0, 0, 595, 122);
        canvas.DrawString("cinema.", new XFont("Cinema", 30, XFontStyleEx.Bold), accent, 36, 55);
        canvas.DrawString("HİKÂYE SENİNLE BAŞLAR", small, XBrushes.White, 38, 87);
        canvas.DrawString("DEMO BİLET", small, accent, new XRect(395, 43, 164, 20), XStringFormats.TopRight);
        canvas.DrawString("FİLM GECEN HAZIR", small, muted, 36, 160);
        var movieFont = heading;
        while (canvas.MeasureString(booking.Screening.Movie.Title, movieFont).Width > 520)
            movieFont = new XFont("Cinema", movieFont.Size - 1, XFontStyleEx.Bold);
        canvas.DrawString(booking.Screening.Movie.Title, movieFont, dark, 36, 196);
        canvas.DrawString("Cinema İstanbul", regular, muted, 36, 222);
        void Field(string label, string value, double x, double y) {
            canvas.DrawString(label, small, muted, x, y);
            canvas.DrawString(value, regular, dark, x, y + 22);
        }
        Field("TARİH", starts.ToString("dd MMMM yyyy, dddd", culture), 36, 269);
        Field("SAAT (TÜRKİYE)", starts.ToString("HH:mm", culture), 370, 269);
        Field("SALON / GÖSTERİM", $"{booking.Screening.Hall} / {booking.Screening.Format}", 36, 330);
        Field("TOPLAM", booking.Total.ToString("N0", culture) + " TL", 370, 330);
        Field("KOLTUKLAR", string.Join(", ", booking.Seats.OrderBy(x => x.Seat[0]).ThenBy(x => int.Parse(x.Seat[1..])).Select(x => x.Seat)), 36, 391);
        var line = new XPen(XColor.FromArgb(171, 182, 156), 1) { DashStyle = XDashStyle.Dash };
        canvas.DrawLine(line, 36, 439, 559, 439);
        canvas.DrawString("BİLET KODU", small, muted, 36, 467);
        canvas.DrawString(booking.Code, new XFont("Cinema", 22, XFontStyleEx.Bold), dark, 36, 499);
        canvas.DrawString("Bu bir demo biletidir. Gerçek ödeme alınmamıştır.", small, muted, 36, 546);
        canvas.DrawString("Biletini sakla. İyi seyirler!", small, muted, 36, 566);
        using var stream = new MemoryStream();
        document.Save(stream, false);
        return stream.ToArray();
    }
}

public class TicketFontResolver : IFontResolver {
    public FontResolverInfo ResolveTypeface(string familyName, bool bold, bool italic) => new("Cinema", bold, italic);
    public byte[] GetFont(string faceName) {
        using var stream = typeof(TicketFontResolver).Assembly.GetManifestResourceStream("Cinema.Api.Fonts.DejaVuSans.ttf")!;
        using var output = new MemoryStream();
        stream.CopyTo(output);
        return output.ToArray();
    }
}
