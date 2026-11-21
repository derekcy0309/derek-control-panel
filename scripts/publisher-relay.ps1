# Local Windows publisher. No Dayline sign-in, no read capability and no shared/cloud secret.
[CmdletBinding()] param(
 [Parameter(Mandatory)][ValidateSet('Enroll','Send','Retry','Status','Confirm')][string]$Action,
 [Parameter(Mandatory)][ValidateSet('home','ngo','chronic','weekly','us')][string]$Series,
 [ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$Day
)
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
$utf=New-Object Text.UTF8Encoding($false,$true)
$dir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DaylinePublisher'
$folder=Join-Path $dir $Series
$keyFile=Join-Path $folder 'channel.dpapi'
$extra=$utf.GetBytes('Dayline/publish/v1/'+$Series)
function Hex($bytes){return [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()}
function Hash($bytes){$h=[Security.Cryptography.SHA256]::Create();try{return Hex ($h.ComputeHash($bytes))}finally{$h.Dispose()}}
function Lock-Directory([string]$path){
 $info=Get-Item -LiteralPath $path -Force
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Unsafe storage path'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $existing=Get-Acl -LiteralPath $path
 $rules=@($existing.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($existing.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and $rules[0].AccessControlType -eq 'Allow' -and ($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl){return}
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetAccessRuleProtection($true,$false)
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule);Set-Acl -LiteralPath $path -AclObject $acl
}
function Seal($bytes){return ,([Security.Cryptography.ProtectedData]::Protect($bytes,$extra,[Security.Cryptography.DataProtectionScope]::CurrentUser))}
function Unseal($bytes){return ,([Security.Cryptography.ProtectedData]::Unprotect($bytes,$extra,[Security.Cryptography.DataProtectionScope]::CurrentUser))}
function Save-New([string]$path,[byte[]]$bytes){
 if(Test-Path -LiteralPath $path){return}
 $temp=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{[IO.File]::WriteAllBytes($temp,$bytes);try{[IO.File]::Move($temp,$path)}catch [IO.IOException]{if(-not [IO.File]::Exists($path)){throw}}}finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
}
function Input-Line{
 if([Console]::IsInputRedirected){return [Console]::ReadLine()}
 [Console]::WriteLine('DAYLINE_READY')
 $line=New-Object Text.StringBuilder
 while($true){$ch=[Console]::ReadKey($true);if($ch.Key -eq 'Enter'){break}
 if($line.Length -gt 750000){throw 'too large'};[void]$line.Append($ch.KeyChar)}
 return $line.ToString()
}
function Send-One([string]$json){
 $body=New-Object Net.Http.StringContent($json,[Text.Encoding]::UTF8,'application/json')
 $res=$null
 try{$res=$http.PostAsync('https://derek-control-panel.vercel.app/api/publications/deliver',$body).GetAwaiter().GetResult()
 if(-not $res.IsSuccessStatusCode){throw ('HTTP '+[int]$res.StatusCode)}
 $reply=$res.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json
 if(@('created','unchanged','revised','no_issue','failed') -notcontains $reply.receipt){throw 'bad receipt'};return $reply
 }finally{$body.Dispose();if($res){$res.Dispose()}}
}
function Confirm-Day([string]$which){
 if(-not $which){throw 'expected publication day'}
 $found=@([IO.Directory]::GetFiles($folder,$which+'-*.receipt')|ForEach-Object{[IO.File]::ReadAllText($_,$utf)|ConvertFrom-Json})
 $issues=@($found|Where-Object{$_.series -ceq $Series -and $_.outcome -ceq 'issue' -and $_.revision -match '^[a-f0-9]{64}$' -and @('created','unchanged') -contains $_.receipt})
 if($issues.Count -gt 0){
  if(@($issues|Select-Object -ExpandProperty revision -Unique).Count -ne 1){throw 'conflicting receipts'}
  $proven=@($issues|Where-Object{$_.replay -ceq 'unchanged'}).Count -gt 0
  [Console]::WriteLine(('DAYLINE_RECEIVED series={0} day={1} published=1 replay_verified={2}' -f $Series,$which,$proven));return
 }
 if(@($found|Where-Object{$_.series -ceq $Series -and $_.outcome -ceq 'no_issue' -and $_.receipt -ceq 'no_issue'}).Count -gt 0){[Console]::WriteLine(('DAYLINE_NO_ISSUE series={0} day={1}' -f $Series,$which));return}
 throw 'no confirmed edition'
}
try{
 if($Action -eq 'Enroll'){
   [void][IO.Directory]::CreateDirectory($dir);Lock-Directory $dir
   [void][IO.Directory]::CreateDirectory($folder);Lock-Directory $folder
   if(-not [IO.File]::Exists($keyFile)){$b=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($b)}finally{$rng.Dispose()}
      Save-New $keyFile (Seal ($utf.GetBytes('dlpub_'+(Hex $b))));[Array]::Clear($b,0,$b.Length)}
   $b=Unseal ([IO.File]::ReadAllBytes($keyFile));try{[Console]::WriteLine(($Series+' '+(Hash $b)))}finally{[Array]::Clear($b,0,$b.Length)};exit 0
 }
 if(-not [IO.File]::Exists($keyFile)){throw 'not enrolled'}
 if($Action -eq 'Status'){[Console]::WriteLine(('series={0} pending={1} receipts={2}' -f $Series,[IO.Directory]::GetFiles($folder,'*.pending').Count,[IO.Directory]::GetFiles($folder,'*.receipt').Count));exit 0}
 if($Action -eq 'Confirm'){Confirm-Day $Day;exit 0}
 if($Action -eq 'Send'){
   $line=Input-Line;if(-not $line -or $line.Length -gt 750000){throw 'invalid line'};$bytes=[Convert]::FromBase64String($line)
   if($bytes.Length -gt 550000){throw 'too large'};$message=$utf.GetString($bytes)|ConvertFrom-Json
   if(@('issue','no_issue','failed') -notcontains $message.outcome -or $null -ne $message.previous){throw 'invalid outcome'}
   if($message.outcome -eq 'issue'){if($message.issue.series -cne $Series -or $message.issue.sourceKind -cne 'codex-scheduled' -or -not $message.issue.original -or $message.issue.published -notmatch '^\d{4}-\d{2}-\d{2}$'){throw 'invalid edition'};$expectedDay=$message.issue.published}
   else{if($message.issue -or $message.scheduledDay -notmatch '^\d{4}-\d{2}-\d{2}$'){throw 'missing scheduled day'};$expectedDay=$message.scheduledDay}
   $tag=$expectedDay+'-'+(Hash $bytes);$pending=Join-Path $folder ($tag+'.pending')
   if(-not [IO.File]::Exists((Join-Path $folder ($tag+'.receipt')))){Save-New $pending (Seal $bytes)}
 }
 $keyBytes=Unseal ([IO.File]::ReadAllBytes($keyFile));$token=$utf.GetString($keyBytes);[Array]::Clear($keyBytes,0,$keyBytes.Length)
 $handler=New-Object Net.Http.HttpClientHandler;$handler.AllowAutoRedirect=$false
 $http=New-Object Net.Http.HttpClient($handler);$http.Timeout=[TimeSpan]::FromSeconds(20)
 $http.DefaultRequestHeaders.Authorization=New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer',$token)
 $errors=0
 try{foreach($file in @([IO.Directory]::GetFiles($folder,'*.pending')|Sort-Object)){
   $target=[IO.Path]::ChangeExtension($file,'receipt')
   try{$json=$utf.GetString((Unseal ([IO.File]::ReadAllBytes($file))));$m=$json|ConvertFrom-Json
       $ans=Send-One $json;$check='not_applicable'
       if($m.outcome -eq 'issue'){
         if(@('created','unchanged') -notcontains $ans.receipt -or $ans.revision -notmatch '^[0-9a-f]{64}$'){throw 'no matching receipt'}
         if(-not [IO.File]::Exists((Join-Path $folder 'first-real-issue.checked'))){$dup=Send-One $json
           if($dup.receipt -cne 'unchanged' -or $dup.revision -cne $ans.revision){throw 'no matching replay'}
           $check='unchanged';Save-New (Join-Path $folder 'first-real-issue.checked') ($utf.GetBytes($ans.revision))}
       }elseif($ans.receipt -cne $m.outcome){throw 'no matching receipt'}
       $data=@{series=$Series;outcome=$m.outcome;receipt=$ans.receipt;replay=$check;revision=$ans.revision;verifiedUtc=[DateTime]::UtcNow.ToString('o')}
       Save-New $target ($utf.GetBytes(($data|ConvertTo-Json -Compress)))
       if([IO.File]::Exists($file)){[IO.File]::Delete($file)};[Console]::WriteLine(('Dayline receipt: '+$ans.receipt+'; replay='+$check))
   }catch{$errors++;[Console]::Error.WriteLine('Dayline delivery unconfirmed; encrypted original retained for retry.')}
 }}finally{$http.Dispose();$handler.Dispose()}
 if($Action -eq 'Send' -and $message.outcome -ne 'failed'){Confirm-Day $expectedDay}
 if($Action -eq 'Retry' -and $Day){Confirm-Day $Day}
 if($errors -gt 0){exit 3};[Console]::WriteLine('Dayline queue clear (queue status only).');exit 0
}catch{[Console]::Error.WriteLine(('Dayline publisher could not complete (line {0}, {1}). No receipt claimed.' -f $_.InvocationInfo.ScriptLineNumber,$_.Exception.GetType().Name));exit 2}
