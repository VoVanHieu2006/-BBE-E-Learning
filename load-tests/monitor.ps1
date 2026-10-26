param([int]$BackendPid,[int]$K6Pid,[string]$Output,[string]$StopFile)
$ErrorActionPreference = 'Stop'
$cores = [Environment]::ProcessorCount
$previous = @{}
while (-not (Test-Path -LiteralPath $StopFile)) {
  $now = [DateTime]::UtcNow
  foreach ($entry in @(@{Name='backend'; Id=$BackendPid},@{Name='k6'; Id=$K6Pid})) {
    $proc = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $cpu = $proc.TotalProcessorTime.TotalSeconds
    $prior = $previous[$entry.Name]
    $pct = if ($prior) { 100 * ($cpu-$prior.Cpu)/($now-$prior.At).TotalSeconds/$cores } else { $null }
    [pscustomobject]@{timestamp=$now.ToString('o');component=$entry.Name;pid=$entry.Id;cpuSeconds=$cpu;cpuMachinePercent=$pct;workingSetBytes=$proc.WorkingSet64;privateBytes=$proc.PrivateMemorySize64} | Export-Csv -LiteralPath $Output -Append -NoTypeInformation
    $previous[$entry.Name] = @{At=$now;Cpu=$cpu}
  }
  Start-Sleep -Seconds 5
}
