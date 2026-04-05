$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
	$hostExecutable = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
	Start-Process -FilePath $hostExecutable -Verb RunAs -ArgumentList @(
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		$PSCommandPath
	)
	exit
}

$choice = Read-Host 'Enable or disable the Private firewall profile? Y = enable, N = disable'

switch ($choice.ToUpper()) {
	'Y' { Set-NetFirewallProfile -Profile Private -Enabled True }
	'N' { Set-NetFirewallProfile -Profile Private -Enabled False }
	default { Write-Host 'Invalid choice. Enter Y to enable or N to disable.' }
}