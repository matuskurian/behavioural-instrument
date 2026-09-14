# Local static server for development and think-alouds.
#   .\serve.ps1            -> http://localhost:8081
#   .\serve.ps1 -Port 9000
#
# The default below is the single source of truth for the port. If you change
# it, change "port" in .claude/launch.json to match, or the editor's preview
# panel will watch the old one and the server will look dead.
#
# The app fetches its content files, so it must be served over http://.
# Opening index.html from the filesystem will fail on CORS.
param([int]$Port = 8081)

$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webp' = 'image/webp'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.md'   = 'text/plain; charset=utf-8'
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ($relative -eq '') { $relative = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

      if ($path.StartsWith($root) -and (Test-Path $path -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $extension = [System.IO.Path]::GetExtension($path).ToLower()
        $context.Response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
        $context.Response.Headers.Add('Cache-Control', 'no-store')
        $context.Response.ContentLength64 = $bytes.Length
        if ($context.Request.HttpMethod -ne 'HEAD') {
          $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $context.Response.StatusCode = 404
        $context.Response.ContentLength64 = 0
      }
    } catch {
      Write-Host "error serving $relative : $($_.Exception.Message)"
    }
    $context.Response.Close()
  }
} finally {
  $listener.Stop()
}
