param([ValidateRange(1,1000)][int]$MaxVus=1000,[ValidateSet('mixed','dashboard','video','quiz','leaderboard')][string]$Mode='mixed',[ValidateRange(1,5)][int]$Repeats=2,[switch]$Stability)
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
  $levels = @(@(1,10,25,50,100,200,300,500,750,1000) | Where-Object { $_ -le $MaxVus })
  if ($levels[-1] -ne $MaxVus) { $levels += $MaxVus }
  foreach ($level in $levels) {
    for ($repeat=1; $repeat -le $Repeats; $repeat++) {
      $fixture = 'cohort-' + [guid]::NewGuid().ToString('N') + '.private.json'
      & node fixtures/seed.mjs --out $fixture
      if ($LASTEXITCODE -ne 0) { throw 'Cohort preparation failed; no load will run.' }
      & node run.mjs --mode $Mode --vus $level --fixture $fixture
      if ($LASTEXITCODE -ne 0) { throw "Stopped at $level VUs: inspect results; no next level will run." }
    }
  }
  if ($Stability -and $MaxVus -eq 1000) {
    $fixture = 'stability-' + [guid]::NewGuid().ToString('N') + '.private.json'
    & node fixtures/seed.mjs --out $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Stability cohort preparation failed' }
    & node run.mjs --mode $Mode --vus 1000 --hold 900 --fixture $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Stability failed' }
  }
} finally { Pop-Location }
