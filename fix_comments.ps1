# Fix remaining 3 corrupted comment lines in routine.js
$utf8 = New-Object System.Text.UTF8Encoding($false)
$path = "js/maestra/modules/routine.js"
$lines = [System.IO.File]::ReadAllLines($path, $utf8)

# Line 219 (index 218): BEBES comment
$lines[218] = "    // INTERFAZ ESPECIAL PARA BEBES"

# Line 222 (index 221): NINOS comment  
$lines[221] = "    // INTERFAZ ESTANDAR PARA NINOS"

# Line 567 (index 566): AUTOMATIZACION comment
$lines[566] = "    // AUTOMATIZACION: Publicar en el Muro automaticamente"

# Fix line 568 - moodEmojis with corrupted emojis
$lines[567] = "    const moodEmojis = { feliz: '😊', normal: '😐', triste: '😢', enojado: '😡' };"

# Fix line 569 - foodEmojis  
$lines[568] = "    const foodEmojis = { todo: '😺', poco: '🍲', nada: '' };"

# Fix line 570 - wallMessage with corrupted chars
$lines[569] = "    const wallMessage = `Actualizacion de Rutina: Dia \${mood}! \${food === 'todo' ? 'Todos los pequenos comieron muy bien hoy!' : 'Estamos completando la jornada con exito.'}``;"

[System.IO.File]::WriteAllLines($path, $lines, $utf8)
Write-Host "Fixed $path"

# Verify no more corrupted patterns
$remaining = Select-String -Path $path -Pattern "Ã|Å¸|â€" | Measure-Object | Select-Object -ExpandProperty Count
Write-Host "Remaining corrupted patterns: $remaining"
