$key = 'sk-cdb732a1f7309f652f0c2f61f0c925703ef7115301c79b92e91b3ae04e3bc288'
$models = @('gemini-3-flash-preview', 'gemini-3.1-pro-preview')

Write-Host "=== 新 Gemini Key 测试 ===" -ForegroundColor Cyan

foreach ($m in $models) {
    $body = @{
        model = $m
        max_tokens = 20
        messages = @(@{ role = 'user'; content = 'Reply OK' })
    } | ConvertTo-Json -Depth 5

    try {
        $r = Invoke-RestMethod -Uri 'https://aicode.cat/v1/chat/completions' `
            -Method POST `
            -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } `
            -Body $body -TimeoutSec 40
        $text = $r.choices[0].message.content
        $fr = $r.choices[0].finish_reason
        if ($text) {
            Write-Host "[$m] OK  content='$text'  finish_reason=$fr" -ForegroundColor Green
        } else {
            Write-Host "[$m] EMPTY  finish_reason=$fr" -ForegroundColor Yellow
        }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "[$m] ERROR $code : $($_.Exception.Message)" -ForegroundColor Red
    }
}
