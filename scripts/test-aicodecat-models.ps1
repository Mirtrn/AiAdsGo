$key1 = 'sk-724e89fe9b15a82c2ea13654e017a6c650ff79ffcdda229cc7b71961635116e3'
$key2 = 'sk-bf6276cd06cb82cab645afb941f727d82dc13343ae9a81f9241317c6edecc78c'

$models1 = @('claude-haiku-4-5-20251001','claude-opus-4-6','claude-opus-4-7','claude-sonnet-4-5-20250929','claude-sonnet-4-6','gpt-5.4')
$models2 = @('gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro','gemini-3-flash-preview','gemini-3-pro-preview','gemini-3.1-pro-preview')

function Test-Model($key, $model, $label) {
    $body = @{
        model = $model
        max_tokens = 10
        messages = @(@{ role = 'user'; content = 'Reply OK' })
    } | ConvertTo-Json -Depth 5
    try {
        $r = Invoke-RestMethod -Uri 'https://aicode.cat/v1/chat/completions' `
            -Method POST `
            -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } `
            -Body $body -TimeoutSec 30
        $text = $r.choices[0].message.content
        $fr = $r.choices[0].finish_reason
        if ($text) {
            Write-Host "[$label] $model => OK  content='$text' finish_reason=$fr" -ForegroundColor Green
        } else {
            Write-Host "[$label] $model => EMPTY  finish_reason=$fr" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[$label] $model => ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "=== Key1 (Claude/GPT 分组) ===" -ForegroundColor Cyan
foreach ($m in $models1) { Test-Model $key1 $m 'Key1' }

Write-Host ""
Write-Host "=== Key2 (Gemini 分组) ===" -ForegroundColor Cyan
foreach ($m in $models2) { Test-Model $key2 $m 'Key2' }
