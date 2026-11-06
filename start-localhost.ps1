$ErrorActionPreference = "SilentlyContinue"
$port = 8080
$root = "c:\Users\bagir\OneDrive\Desktop\BCG"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Start()
} catch {
    # Artıq 8080 portunda işləyirsə çıx
    exit 0
}

Write-Output "BCG Localhost server aktivdir: http://localhost:$port/"

$mimeTypes = @{
    ".html"    = "text/html; charset=utf-8"
    ".css"     = "text/css; charset=utf-8"
    ".js"      = "application/javascript; charset=utf-8"
    ".json"    = "application/json; charset=utf-8"
    ".geojson" = "application/json; charset=utf-8"
    ".kml"     = "application/vnd.google-earth.kml+xml"
    ".kmz"     = "application/vnd.google-earth.kmz"
    ".svg"     = "image/svg+xml"
    ".png"     = "image/png"
    ".jpg"     = "image/jpeg"
    ".jpeg"    = "image/jpeg"
    ".ico"     = "image/x-icon"
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        # Hər yenilənmədə ən son dəyişikliklər görünsün (keşlənməsin)
        $res.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        $res.Headers.Add("Access-Control-Allow-Origin", "*")

        $relPath = [System.Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($relPath)) {
            $relPath = "index.html"
        }

        $filePath = Join-Path $root ($relPath -replace '/', '\')
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $bytes.Length
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - Fayl tapilmadi: $relPath")
            $res.ContentLength64 = $msg.Length
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
        $res.OutputStream.Close()
    } catch {
        # Tək sorğu xətası serveri dayandırmasın
    }
}
