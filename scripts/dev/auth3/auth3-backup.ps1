<#
AUTH-3 (Step 4B): encrypted Development backup and isolated local restore proof.
Windows PowerShell 5.1 compatible. Read-only against the source database. Contains no secrets.

  Backup : .\auth3-backup.ps1 -Mode Backup  -DbHost <Dev Session pooler host>        (prompts for the database password)
  Restore: .\auth3-backup.ps1 -Mode Restore -OutDir <backup folder> -KeyFile <pass.txt> (local 127.0.0.1 scratch cluster only)

-Rehearsal runs either mode against the local scratch cluster (no prompt, no expected-value check) to test this script.
Nothing here writes to Development, restores into Development, downloads Storage objects, or touches Production.
#>
param(
  [Parameter(Mandatory)][ValidateSet('Backup','Restore')][string]$Mode,
  [string]$DbHost, [int]$DbPort = 5432, [string]$DbUser = 'postgres.srxunxiytojjsuhcmzjg', [string]$DbName = 'postgres',
  [string]$OutDir, [string]$KeyFile, [string]$BackupRoot = (Join-Path $env:USERPROFILE 'BPC-Backups'),
  [string]$KeyRoot = (Join-Path $env:USERPROFILE 'BPC-Backups-Keys'),
  [string]$LocalPort = '54329', [string]$LogRoot = (Join-Path $env:USERPROFILE 'BPC-Backups-Logs'), [switch]$Rehearsal, [switch]$KeepRestoredDb
)
$ErrorActionPreference = 'Stop'
$gpg = 'C:\Program Files\Git\usr\bin\gpg.exe'; $ssl = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
$pgb = 'C:\Program Files\PostgreSQL\18\bin'
$ExpectedLedger = 'ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999'
$DevRef = 'srxunxiytojjsuhcmzjg'; $ProdRef = 'qaagfafagdpgzcijnfbw'
foreach ($t in $gpg, $ssl, "$pgb\pg_dump.exe", "$pgb\pg_restore.exe", "$pgb\psql.exe") { if (-not (Test-Path $t)) { throw "Missing dependency: $t (not installing anything)" } }
function P($x) { '/' + $x.Substring(0,1).ToLower() + $x.Substring(2).Replace('\','/') }

# SQL used identically before the backup and after the restore (aggregates and md5 only; no personal data is printed)
$checks = @'
SET TimeZone = 'UTC';
select 'ledger' k, count(*)::text || '|' || max(version) || '|' || encode(sha256(convert_to(string_agg(version || '|' || coalesce(name,'') || '|' || md5(coalesce(array_to_string(statements, E'\n'),'')), E'\n' ORDER BY version), 'UTF8')), 'hex') v from supabase_migrations.schema_migrations
union all
select 'tbl ' || s || '.' || t, (xpath('/row/c/text()', query_to_xml(format('select count(*) || ''|'' || coalesce(md5(string_agg(x::text, E''\n'' order by x::text)),'''') c from %I.%I x', s, t), false, true, '')))[1]::text
from (select table_schema s, table_name t from information_schema.tables where table_type = 'BASE TABLE' and ((table_schema = 'public') or (table_schema, table_name) in (('auth','users'),('auth','identities'),('storage','objects'),('storage','buckets'))) ) q
union all
select 'storage_meta', count(*) || '|' || coalesce(sum((metadata->>'size')::bigint),0) || '|' || md5(string_agg(bucket_id || '/' || name || '|' || coalesce(metadata->>'size',''), E'\n' order by bucket_id, name)) from storage.objects
union all
select 'containment', has_schema_privilege('anon','public','USAGE')::text || '|' || has_schema_privilege('authenticated','public','USAGE')::text
union all
select 'extensions', string_agg(extname, ',' order by extname) from pg_extension
order by 1
'@

function Run-Psql($sqlText, $h, $p, $u, $d) {
  $f = Join-Path $env:TEMP ('auth3-q-' + [guid]::NewGuid().ToString('N') + '.sql')
  [IO.File]::WriteAllText($f, $sqlText)
  try { $r = & "$pgb\psql.exe" -X -q -h $h -p $p -U $u -d $d -At -F '|' -v ON_ERROR_STOP=1 -f $f; if ($LASTEXITCODE -ne 0) { throw "psql failed ($LASTEXITCODE)" }; return ,$r } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}
# schema fingerprint (11 categories) from the repository's own read-only statement
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$fpSql = & node -e "process.stdout.write(require(process.argv[1]).DIGEST_ROWS)" (Join-Path $repo 'scripts\dev\hosted-executor\lib\fingerprint.cjs')
if ($LASTEXITCODE -ne 0 -or -not $fpSql) { throw 'could not load the fingerprint statement (node dependency)' }
$localPre = 'SET search_path = "$user", public, extensions;' + "`n"

if ($Mode -eq 'Backup') {
  if (-not $DbHost) { throw '-DbHost is required (Development Session pooler host, port 5432)' }
  if (-not $Rehearsal -and ($DbUser -notmatch ('\.' + $DevRef + '$') -or $DbUser -match $ProdRef -or $DbHost -match $ProdRef)) { throw 'ABORT: the connection is not the Development project. Production is out of scope.' }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmZ')
  $OutDir = Join-Path $BackupRoot "dev-$stamp"; $keys = Join-Path $KeyRoot "dev-$stamp"
  if ($Rehearsal) { $DbHost = '127.0.0.1'; $DbPort = [int]$LocalPort; $DbUser = 'postgres' }
  New-Item -ItemType Directory -Force $OutDir, $keys, "$OutDir\gnupg" | Out-Null
  foreach ($d in $OutDir, $keys) { & icacls.exe $d /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Warning "could not restrict $d to the owner account" } }
  [IO.File]::WriteAllText("$keys\pass.txt", (& $ssl rand -hex 32))
  Write-Host "Key file (copy into your password manager NOW, then delete the file): $keys\pass.txt"
  if (-not $Rehearsal) {
    $sec = Read-Host 'Development database password (typed, not echoed)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $env:PGSSLMODE = 'require'
  }
  try {
    $pre = Run-Psql $checks $DbHost $DbPort $DbUser $DbName
    $pre | Set-Content "$OutDir\pre-checks.txt" -Encoding ascii
    $fpPre = Run-Psql $fpSql $DbHost $DbPort $DbUser $DbName
    $fpPre | Set-Content "$OutDir\pre-fingerprint.txt" -Encoding ascii
    $led = ($pre | Where-Object { $_ -like 'ledger|*' })
    Write-Host "Pre-backup ledger: $led"
    if (-not $Rehearsal -and ($led -ne "ledger|58|20260929161925|$ExpectedLedger")) { throw "ABORT: ledger differs from the AUTH-1 baseline. Report; do not retry." }
    $g = "`"$gpg`" --homedir `"$(P "$OutDir\gnupg")`" --batch --yes --pinentry-mode loopback --passphrase-file `"$(P "$keys\pass.txt")`""
    $enc = "--symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712"
    # database dump straight into encryption: no plaintext file
    cmd /c "`"$pgb\pg_dump.exe`" -h $DbHost -p $DbPort -U $DbUser -d $DbName --format=custom --compress=6 --lock-wait-timeout=60s --verbose 2> `"$OutDir\dump.log`" | $g $enc -o `"$(P "$OutDir\dev.dump.gpg")`""
    if ($LASTEXITCODE -ne 0) { throw "dump|encrypt failed ($LASTEXITCODE); see $OutDir\dump.log. Report; do not widen privileges." }
    # the pipe hides pg_dump's own exit code: scan its log and prove the decrypted stream is a complete archive
    if (Select-String -Path "$OutDir\dump.log" -Pattern '^pg_dump: (error|fatal)' -Quiet) { throw "pg_dump reported an error; see $OutDir\dump.log. Report; do not widen privileges." }
    cmd /c "`"$gpg`" --homedir `"$(P "$OutDir\gnupg")`" --batch --pinentry-mode loopback --passphrase-file `"$(P "$keys\pass.txt")`" --decrypt `"$(P "$OutDir\dev.dump.gpg")`" 2>NUL | `"$pgb\pg_restore.exe`" --list > NUL 2>NUL"
    if ($LASTEXITCODE -ne 0) { throw 'the encrypted dump is not a complete, readable archive (pg_restore --list failed)' }
    # roles manifest (names, attributes, memberships; no passwords), encrypted
    $rolesSql = "select 'R|'||rolname||'|'||rolsuper||'|'||rolcanlogin||'|'||rolbypassrls from pg_roles where rolname !~ '^pg_' union all select 'M|'||r.rolname||'|'||m.rolname from pg_auth_members am join pg_roles r on r.oid=am.roleid join pg_roles m on m.oid=am.member order by 1"
    $rf = Join-Path $env:TEMP 'auth3-roles.sql'; [IO.File]::WriteAllText($rf, $rolesSql)
    cmd /c "`"$pgb\psql.exe`" -X -h $DbHost -p $DbPort -U $DbUser -d $DbName -At -f `"$rf`" | $g $enc -o `"$(P "$OutDir\roles.txt.gpg")`""
    $rc = $LASTEXITCODE; Remove-Item $rf -Force
    if ($rc -ne 0) { throw 'roles manifest failed' }
    $rolesCheck = cmd /c "`"$gpg`" --homedir `"$(P "$OutDir\gnupg")`" --batch --pinentry-mode loopback --passphrase-file `"$(P "$keys\pass.txt")`" --decrypt `"$(P "$OutDir\roles.txt.gpg")`" 2>NUL"
    if (@($rolesCheck | Where-Object { $_ -like 'R|*' }).Count -lt 1) { throw 'roles manifest is empty' }
    # hashes: encrypted files, and plaintext through a decrypt pipe
    $h1 = (Get-FileHash "$OutDir\dev.dump.gpg" -Algorithm SHA256).Hash; $h2 = (Get-FileHash "$OutDir\roles.txt.gpg" -Algorithm SHA256).Hash
    $plain = cmd /c "`"$gpg`" --homedir `"$(P "$OutDir\gnupg")`" --batch --pinentry-mode loopback --passphrase-file `"$(P "$keys\pass.txt")`" --decrypt `"$(P "$OutDir\dev.dump.gpg")`" 2>NUL | `"$ssl`" dgst -sha256"
    $post = Run-Psql $checks $DbHost $DbPort $DbUser $DbName
    $same = (($pre -join "`n") -eq ($post -join "`n"))
    @("dev.dump.gpg sha256 $h1", "roles.txt.gpg sha256 $h2", "plaintext dump $plain", "bytes $((Get-Item "$OutDir\dev.dump.gpg").Length)", "source unchanged during backup: $same", "utc $stamp") | Set-Content "$OutDir\hashes.txt" -Encoding ascii
    Get-Content "$OutDir\hashes.txt"
    Write-Host "Encrypted backup: $OutDir"
    Write-Host "NEXT: store $keys\pass.txt in the password manager, delete it, then run -Mode Restore -OutDir `"$OutDir`" -KeyFile <the key file>."
  } finally { Remove-Item Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue }
}
else {
  if (-not $OutDir -or -not $KeyFile) { throw '-OutDir and -KeyFile are required' }
  $lp = $LocalPort; $db = 'bpc_auth3_restore'
  $logDir = Join-Path $LogRoot ('restore-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')); New-Item -ItemType Directory -Force $logDir | Out-Null
  $errFile = Join-Path $logDir 'restore.err'   # the retained backup folder is read only: nothing is written into it by this mode
  $listen = (& "$pgb\psql.exe" -X -h 127.0.0.1 -p $lp -U postgres -d postgres -Atc 'show listen_addresses')
  if ($listen -ne '127.0.0.1' -and $listen -ne 'localhost') { throw "ABORT: local cluster listens on '$listen', not loopback only." }
  $g = "`"$gpg`" --homedir `"$(P "$OutDir\gnupg")`" --batch --pinentry-mode loopback --passphrase-file `"$(P $KeyFile)`""
  $dec = "$g --decrypt `"$(P "$OutDir\dev.dump.gpg")`""
  $enc1 = (Get-FileHash "$OutDir\dev.dump.gpg" -Algorithm SHA256).Hash
  $recorded = (Select-String -Path "$OutDir\hashes.txt" -Pattern '^dev.dump.gpg sha256 (\w+)').Matches.Groups[1].Value
  if ($enc1 -ne $recorded) { throw 'ABORT: encrypted file hash differs from the recorded hash' }
  $plain = cmd /c "$dec 2>NUL | `"$ssl`" dgst -sha256"
  if ((Get-Content "$OutDir\hashes.txt" | Select-String 'plaintext dump').Line -ne "plaintext dump $plain") { throw 'ABORT: decrypted plaintext hash differs from the recorded hash' }
  # roles: names only, NOLOGIN, no passwords
  $roles = cmd /c "$g --decrypt `"$(P "$OutDir\roles.txt.gpg")`" 2>NUL"
  $sql = New-Object Collections.Generic.List[string]
  foreach ($l in $roles) { $a = $l -split '\|'; if ($a[0] -eq 'R' -and $a[1] -ne 'postgres') { $sql.Add("do `$`$ begin if not exists (select 1 from pg_roles where rolname = '$($a[1])') then create role `"$($a[1])`" nologin; end if; end `$`$;") } }
  foreach ($l in $roles) { $a = $l -split '\|'; if ($a[0] -eq 'M') { $sql.Add("do `$`$ begin if exists (select 1 from pg_roles where rolname = '$($a[1])') and exists (select 1 from pg_roles where rolname = '$($a[2])') then execute format('grant %I to %I', '$($a[1])', '$($a[2])'); end if; exception when others then null; end `$`$;") } }
  Run-Psql ($sql -join "`n") 127.0.0.1 $lp postgres postgres | Out-Null
  Run-Psql "drop database if exists $db" 127.0.0.1 $lp postgres postgres | Out-Null
  Run-Psql "create database $db" 127.0.0.1 $lp postgres postgres | Out-Null
  # restore straight from the decrypt pipe; every error is logged and classified, none is hidden
  cmd /c "$dec 2>NUL | `"$pgb\pg_restore.exe`" -h 127.0.0.1 -p $lp -U postgres -d $db --no-password 2> `"$errFile`""
  $rx = $LASTEXITCODE
  $errs = @(Get-Content $errFile -ErrorAction SilentlyContinue | Where-Object { $_ -like 'pg_restore: error:*' })
  # classification: only the two documented platform limitations are expected locally; anything else is UNEXPECTED
  $expected = @($errs | Where-Object { $_ -match 'supabase_vault|vault\.|vault_' -or $_ -match 'permission denied to change owner of event trigger' })
  $unexpected = @($errs | Where-Object { $_ -notin $expected })
  Write-Host "pg_restore exit $rx; error lines: $($errs.Count) (expected platform limitations: $($expected.Count); UNEXPECTED: $($unexpected.Count)); full log: $errFile"
  $errs | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" }
  $res = Run-Psql $checks 127.0.0.1 $lp postgres $db
  $fpRes = Run-Psql ($localPre + $fpSql) 127.0.0.1 $lp postgres $db | Where-Object { $_ -ne 'SET' }
  $pre = Get-Content "$OutDir\pre-checks.txt"; $fpPre = Get-Content "$OutDir\pre-fingerprint.txt"
  $d1 = @(Compare-Object $pre $res); $d2 = @(Compare-Object $fpPre $fpRes)
  # the only tolerated content difference is the platform-managed supabase_vault extension being absent locally
  $d1bad = @($d1 | Where-Object { $_.InputObject -notlike 'extensions|*' })
  Write-Host ("data checks: {0} differing lines ({1} outside the extension list); fingerprint: {2} differing lines" -f $d1.Count, $d1bad.Count, $d2.Count)
  $d1 | ForEach-Object { Write-Host "  DATA $($_.SideIndicator) $($_.InputObject)" }
  $d2 | ForEach-Object { Write-Host "  FP   $($_.SideIndicator) $($_.InputObject)" }
  $summary = $res | Where-Object { $_ -like 'containment|*' -or $_ -like 'ledger|*' -or $_ -like 'storage_meta|*' }
  $summary | ForEach-Object { Write-Host "  $_" }
  $ok = ($unexpected.Count -eq 0) -and ($d1bad.Count -eq 0) -and ($d2.Count -eq 0) -and ($summary -contains 'containment|false|false')
  if (-not $Rehearsal) { $ok = $ok -and ($summary -contains "ledger|58|20260929161925|$ExpectedLedger") -and ($summary -contains 'storage_meta|500|941404649|' + ($pre | Where-Object { $_ -like 'storage_meta|*' }).Split('|')[3]) }
  if (-not $KeepRestoredDb) { Run-Psql "drop database if exists $db" 127.0.0.1 $lp postgres postgres | Out-Null; Write-Host 'Restored copy dropped.' }
  if ($ok) { Write-Host 'RESULT: PASS for application data, ledger, fingerprint, Storage metadata and containment. Managed-Supabase restoration is PARTIAL (vault and platform event triggers cannot be restored locally); full platform equivalence is NOT PROVEN.' }
  else { Write-Host 'RESULT: FAIL. Stop and investigate; do not accept it.'; exit 1 }
  Write-Host "Then delete the key file: $KeyFile (the passphrase must live in your password manager)."
}



