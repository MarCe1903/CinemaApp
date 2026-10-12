using Microsoft.AspNetCore.Authentication;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Cinema.Api;

public static class AccessControl {
    public const string Member = "Member";
    public const string Manager = "Manager";
    public const string Admin = "Admin";
    public static readonly string[] Roles = [Member, Manager, Admin];

    public static async Task<object> Profile(AppUser user, UserManager<AppUser> users) =>
        new { user.Id, user.DisplayName, user.Email, user.UserName, roles = await users.GetRolesAsync(user) };

    public static async Task ValidateSession(CookieValidatePrincipalContext context) {
        var users = context.HttpContext.RequestServices.GetRequiredService<UserManager<AppUser>>();
        var signIn = context.HttpContext.RequestServices.GetRequiredService<SignInManager<AppUser>>();
        var user = await users.GetUserAsync(context.Principal!);
        if (user is null || context.Principal!.FindFirstValue(users.Options.ClaimsIdentity.SecurityStampClaimType) != await users.GetSecurityStampAsync(user)) {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
            return;
        }
        // Read current roles on every request, so revocation applies to existing cookies.
        context.ReplacePrincipal(await signIn.CreateUserPrincipalAsync(user));
    }

    public static async Task Initialize(IServiceProvider services, bool development, IConfiguration configuration) {
        var roles = services.GetRequiredService<RoleManager<IdentityRole>>();
        var users = services.GetRequiredService<UserManager<AppUser>>();
        foreach (var name in Roles) {
            if (!await roles.RoleExistsAsync(name)) Ensure(await roles.CreateAsync(new IdentityRole(name)));
        }
        var db = services.GetRequiredService<CinemaDb>();
        foreach (var user in await db.Users.Where(user => !db.UserRoles.Any(role => role.UserId == user.Id)).ToListAsync())
            Ensure(await users.AddToRoleAsync(user, Member));

        var adminPassword = configuration["Cinema:SeedAdminPassword"];
        if (development && !string.IsNullOrWhiteSpace(adminPassword) && await users.FindByNameAsync("admin") is null) {
            var admin = new AppUser { UserName = "admin", Email = "admin@example.test", DisplayName = "Cinema Admin" };
            // Explicit local setup only; apply the same password policy as other accounts.
            Ensure(await users.CreateAsync(admin, adminPassword));
            Ensure(await users.AddToRoleAsync(admin, Admin));
        }
    }

    public static void Ensure(IdentityResult result) {
        if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(x => x.Description)));
    }
}
