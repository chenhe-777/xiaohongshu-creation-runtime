param(
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$true)][string]$Out
)
# Replay of the successful 2026-09-17 public-share requests; no browser login.
$ErrorActionPreference = 'Stop'
$sourceUri = [uri]$Url
if ($sourceUri.Scheme -notin @('http','https') -or $sourceUri.Host -notin @('xhslink.cn','xhslink.com','www.xiaohongshu.com','www.rednote.com')) {
    throw 'Use an original Xiaohongshu public share URL.'
}
$requestUrl = $Url
if ($sourceUri.Host -in @('xhslink.cn','xhslink.com')) { $requestUrl = $Url -replace '^https:', 'http:' }
$runDir = Join-Path ([IO.Path]::GetFullPath($Out)) (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
try {
    $response = Invoke-WebRequest -Uri $requestUrl -Headers @{'User-Agent'=$ua;'Accept-Language'='zh-CN,zh;q=0.9'} -MaximumRedirection 10 -UseBasicParsing -TimeoutSec 25
    $response.Content | Set-Content -LiteralPath (Join-Path $runDir 'page.html') -Encoding utf8
    $finalUrl = if ($response.BaseResponse.RequestMessage) { $response.BaseResponse.RequestMessage.RequestUri.AbsoluteUri } else { $response.BaseResponse.ResponseUri.AbsoluteUri }
    @{source=$Url;request=$requestUrl;final=$finalUrl;status=[int]$response.StatusCode;client='PowerShell Invoke-WebRequest';capturedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'request.json') -Encoding utf8
    # Reuse the maintained parser; do not maintain a second page-state parser.
    @'
const fs=require('fs'),path=require('path');
const [toolDir,dir]=process.argv.slice(2);
const {extractNoteFromHtml}=require(path.join(toolDir,'collect.js'));
const read=f=>fs.readFileSync(path.join(dir,f),'utf8').replace(/^\uFEFF/,'');
const request=JSON.parse(read('request.json'));
const id=new URL(request.final).pathname.split('/').find(x=>/^[0-9a-f]{24}$/i.test(x));
if(!id) throw Error('No target note ID in final URL; inspect saved page.html and request.json.');
const note=extractNoteFromHtml(read('page.html'),id),card=note.noteCard;
fs.writeFileSync(path.join(dir,'note.json'),JSON.stringify(note,null,2));
fs.mkdirSync(path.join(dir,'images'),{recursive:true});
const jobs=(card.imageList||[]).map((im,i)=>({page:i+1,url:(im.urlDefault||im.urlPre||im.url||im.infoList?.find(x=>x.url)?.url||'').replace(/^http:/,'https:'),file:path.join(dir,'images',`page-${String(i+1).padStart(2,'0')}.jpg`)}));
fs.writeFileSync(path.join(dir,'download-list.json'),JSON.stringify(jobs,null,2));
console.log(JSON.stringify({id,title:card.title,author:card.user?.nickname,expectedImages:jobs.length}));
'@ | node - $PSScriptRoot $runDir
    if ($LASTEXITCODE -ne 0) { throw 'Page parsing failed; raw response retained.' }
    $items = @(Get-Content -LiteralPath (Join-Path $runDir 'download-list.json') -Raw -Encoding utf8 | ConvertFrom-Json)
    $records = @()
    foreach ($item in $items) {
        try {
            $imageUri = [uri]$item.url
            if ($imageUri.Scheme -ne 'https' -or $imageUri.Host -notmatch '(^|\.)(xhscdn\.com|xiaohongshu\.com)$') { throw 'Missing or unexpected public image host.' }
            Invoke-WebRequest -Uri $item.url -Headers @{'User-Agent'=$ua;'Referer'='https://www.xiaohongshu.com/'} -OutFile $item.file -UseBasicParsing -TimeoutSec 20
            $records += @{page=$item.page;ok=$true;file=$item.file;sha256=(Get-FileHash -LiteralPath $item.file -Algorithm SHA256).Hash}
        } catch { $records += @{page=$item.page;ok=$false;file=$item.file;error=$_.Exception.Message} }
        ConvertTo-Json -InputObject @($records) -Depth 5 | Set-Content -LiteralPath (Join-Path $runDir 'media-capture.json') -Encoding utf8
        Start-Sleep -Milliseconds 250
    }
    @'
const fs=require('fs'),path=require('path');
const [toolDir,dir]=process.argv.slice(2),{imageDimensions}=require(path.join(toolDir,'collect.js'));
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8').replace(/^\uFEFF/,''));
const note=read('note.json'),expected=(note.noteCard.imageList||[]).length;
const images=expected?read('media-capture.json'):[];
for(const image of images) if(image.ok){image.dimensions=imageDimensions(fs.readFileSync(image.file));if(!image.dimensions?.width){image.ok=false;image.error='Response is not a supported image';}}
const downloaded=images.filter(x=>x.ok).length,unique=new Set(images.filter(x=>x.ok).map(x=>x.sha256)).size;
const capture={id:note.id,title:note.noteCard.title,author:note.noteCard.user?.nickname,expectedImages:expected,downloadedImages:downloaded,uniqueImages:unique,allImagesComplete:expected>0&&expected===downloaded&&downloaded===unique,readPages:[],bodyRead:false,commentScope:'not collected',images};
fs.writeFileSync(path.join(dir,'capture.json'),JSON.stringify(capture,null,2));
console.log(JSON.stringify({directory:dir,expected,downloaded,unique,allImagesComplete:capture.allImagesComplete,reading:'pending'}));
if(!capture.allImagesComplete)process.exitCode=2;
'@ | node - $PSScriptRoot $runDir
    if ($LASTEXITCODE -ne 0) { throw 'Image collection incomplete; inspect capture.json.' }
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $runDir 'error.txt') -Encoding utf8
    throw
}
