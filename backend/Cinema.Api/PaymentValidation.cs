using System.Text.RegularExpressions;
namespace Cinema.Api;
public record DemoPayment(string? Cardholder, string? CardNumber, string? Expiry, string? Cvv);
public static class PaymentValidation {
    // Format checks only: no bank call, card charge, Luhn check or card-data storage.
    public static string? Error(DemoPayment? payment) {
        if (payment is null || string.IsNullOrWhiteSpace(payment.Cardholder) || string.IsNullOrWhiteSpace(payment.CardNumber) ||
            string.IsNullOrWhiteSpace(payment.Expiry) || string.IsNullOrWhiteSpace(payment.Cvv))
            return "Lütfen tüm ödeme alanlarını doldurun.";
        if (payment.Cardholder.Trim().Length is < 2 or > 80) return "Kart üzerindeki ad 2-80 karakter olmalıdır.";
        if (payment.CardNumber.Length > 19 || !Regex.IsMatch(payment.CardNumber.Replace(" ", ""), "^[0-9]{16}$"))
            return "Kart numarası 16 rakam olmalıdır.";
        if (!Regex.IsMatch(payment.Expiry, "^(0[1-9]|1[0-2])/[0-9]{2}$")) return "Son kullanma tarihini AA/YY biçiminde girin (örnek: 12/29).";
        if (!Regex.IsMatch(payment.Cvv, "^[0-9]{3}$")) return "CVV 3 rakam olmalıdır.";
        return null;
    }
}
