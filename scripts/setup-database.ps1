$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'
$localSettingsFile = Join-Path $root 'backend/Cinema.Api/appsettings.Local.json'

function New-LocalPassword {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return 'Cinema!9a' + [BitConverter]::ToString($bytes).Replace('-', '')
}

if (-not (Test-Path -LiteralPath $envFile)) {
    Set-Content -LiteralPath $envFile -Value "MSSQL_SA_PASSWORD=$(New-LocalPassword)" -Encoding utf8
}
$entry = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^MSSQL_SA_PASSWORD=' } | Select-Object -First 1
if (-not $entry) { throw 'MSSQL_SA_PASSWORD is missing from the local .env file.' }
$password = $entry.Substring('MSSQL_SA_PASSWORD='.Length)
if ([string]::IsNullOrWhiteSpace($password)) { throw 'MSSQL_SA_PASSWORD must not be empty.' }
# Quote the value so connection-string punctuation in a chosen password is safe.
$quotedPassword = '"' + $password.Replace('"', '""') + '"'
$connection = "Server=127.0.0.1,14333;Database=CinemaApp;User Id=sa;Password=$quotedPassword;Encrypt=True;TrustServerCertificate=True"

$settings = if (Test-Path -LiteralPath $localSettingsFile) {
    Get-Content -LiteralPath $localSettingsFile -Raw | ConvertFrom-Json
} else { [pscustomobject]@{} }
if (-not $settings.ConnectionStrings) { $settings | Add-Member -MemberType NoteProperty -Name ConnectionStrings -Value ([pscustomobject]@{}) -Force }
$settings.ConnectionStrings | Add-Member -MemberType NoteProperty -Name Cinema -Value $connection -Force
if (-not $settings.Cinema) { $settings | Add-Member -MemberType NoteProperty -Name Cinema -Value ([pscustomobject]@{}) -Force }
if ([string]::IsNullOrWhiteSpace($settings.Cinema.SeedAdminPassword)) {
    $settings.Cinema | Add-Member -MemberType NoteProperty -Name SeedAdminPassword -Value (New-LocalPassword) -Force
}
$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $localSettingsFile -Encoding utf8
docker compose --project-directory $root up -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Could not start the Docker SQL Server service.' }
Write-Host 'SQL Server is ready at 127.0.0.1,14333.'
Write-Host 'SQL credentials are stored in the ignored .env and appsettings.Local.json files.'
Write-Host 'For a new development database, admin uses Cinema.SeedAdminPassword from appsettings.Local.json.'
Write-Host 'Existing admin accounts are not reset. Do not commit or share these local files.'
