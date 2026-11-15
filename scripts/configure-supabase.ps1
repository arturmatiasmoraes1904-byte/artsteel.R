$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'apps\api\.env'
if (Test-Path -LiteralPath $target) { throw 'apps/api/.env já existe. Nenhuma configuração foi substituída.' }
$securePassword = Read-Host 'Digite a senha do banco que você definiu no Supabase (entrada oculta)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try { $databasePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
if ([string]::IsNullOrWhiteSpace($databasePassword)) { throw 'A senha não pode estar vazia.' }
function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes)
}
$appPassword = New-LocalSecret
$jwtSecret = New-LocalSecret
$encodedAdmin = [Uri]::EscapeDataString($databasePassword)
$encodedApp = [Uri]::EscapeDataString($appPassword)
$configuration = @(
  "DATABASE_ADMIN_URL=postgresql://postgres.ufvuirjgycmmgzjtumwz:$encodedAdmin@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
  "DATABASE_URL=postgresql://nexo_app.ufvuirjgycmmgzjtumwz:$encodedApp@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
  "DATABASE_APP_PASSWORD=$appPassword"
  "JWT_SECRET=$jwtSecret"
  'WEB_ORIGIN=http://localhost:3000'
  'PORT=3333'
)
[IO.File]::WriteAllLines($target, $configuration, (New-Object Text.UTF8Encoding($false)))
$databasePassword = $null
$encodedAdmin = $null
$configuration = $null
Write-Host 'Configuração local salva. Nenhuma migração foi executada e nenhuma senha foi exibida.'
Write-Host 'Volte ao chat e avise que a configuração foi concluída.'

