param(
    [string]$ShortcutDirectory = "$env:USERPROFILE\Desktop"
)

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
    @{ Name = "Sabores da Canastra - PDV"; Target = Join-Path $projectDirectory "Abrir-PDV.bat"; Description = "Abrir o ponto de venda" },
    @{ Name = "Sabores da Canastra - Gestão"; Target = Join-Path $projectDirectory "Abrir-Gestao.bat"; Description = "Abrir custos, receitas, compras e gastos" }
)

New-Item -ItemType Directory -Path $ShortcutDirectory -Force | Out-Null
foreach ($item in $shortcuts) {
    $shortcutPath = Join-Path $ShortcutDirectory ($item.Name + ".lnk")
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $item.Target
    $shortcut.WorkingDirectory = $projectDirectory
    $shortcut.Description = $item.Description
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Output $shortcutPath
}
