$utf8 = New-Object System.Text.UTF8Encoding($false)

function Fix-Encoding($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $text = $utf8.GetString($bytes)
    $orig = $text

    # === SPANISH CHARACTERS (remaining patterns) ===
    # These use Ãƒ prefix (C3 83) which wasn't caught by first pass
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xB1)), "n")    # n~
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xA9)), "e")    # e'
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xB3)), "o")    # o'
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xA1)), "a")    # a'
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xAD)), "i")    # i'
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x83,0xC2,0xBA)), "u")    # u'

    # === EMOJI PATTERNS (4-byte UTF-8 emojis that got double-encoded) ===
    # Pattern: F0 9F XX YY (4-byte emoji) became C3 B0 C5 B8 XX YY after double encoding
    # We replace specific known corrupted emoji sequences with clean text or simple emoji

    # Remove corrupted emoji sequences - replace with empty or simple text
    # Pattern starts with C3 B0 C5 B8 (= corrupted F0 9F)
    $emojiStart = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8))
    
    # Keep removing corrupted emoji sequences until none remain
    $maxIter = 100
    $iter = 0
    while ($text.Contains($emojiStart) -and $iter -lt $maxIter) {
        $idx = $text.IndexOf($emojiStart)
        # Find end of corrupted sequence (usually 2-4 more bytes worth of corruption)
        $end = $idx + 4
        # Consume additional bytes of the corrupted emoji (max 8 chars total)
        while ($end -lt $text.Length -and $end -lt ($idx + 8)) {
            $c = [int][char]$text[$end]
            # C2/C3 prefix bytes or specific continuation bytes
            if ($c -eq 0xC3 -or $c -eq 0xC2 -or $c -eq 0xC5 -or $c -eq 0xCB -or $c -eq 0xE2 -or $c -eq 0xC4) {
                $end += 2  # skip the 2-byte sequence
            } else {
                break
            }
        }
        $segment = $text.Substring($idx, [Math]::Min($end - $idx, $text.Length - $idx))
        # Replace with empty string (remove corrupted emoji)
        $text = $text.Remove($idx, [Math]::Min($end - $idx, $text.Length - $idx))
        $iter++
    }

    # Remove other corrupted sequences: C3 82 (Â), C2 A1 (¡), C2 BF (¿) that are residual
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x82,0xC2,0xA1)), "!")   # ¡ -> !
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x82,0xC2,0xBF)), "?")   # ¿ -> ?
    $text = $text.Replace($utf8.GetString([byte[]](0xC3,0x82)), "")               # residual Â
    
    # Remove corrupted checkmark sequences: C3 A2 C5 85 (= Ã¢Å")
    $check = $utf8.GetString([byte[]](0xC3,0xA2,0xC5,0x85))
    while ($text.Contains($check)) {
        $idx = $text.IndexOf($check)
        $end = $idx + 4
        while ($end -lt $text.Length -and $end -lt ($idx + 6)) {
            $c = [int][char]$text[$end]
            if ($c -gt 0x7F) { $end += 2 } else { break }
        }
        $text = $text.Remove($idx, [Math]::Min($end - $idx, $text.Length - $idx))
    }

    if ($text -ne $orig) {
        [System.IO.File]::WriteAllBytes($path, $utf8.GetBytes($text))
        $cnt = (Select-String -Path $path -Pattern "Ãƒ|Ã‚|Ã°Å" | Measure-Object).Count
        Write-Host "FIXED: $path (remaining bad: $cnt)"
    } else {
        Write-Host "UNCHANGED: $path"
    }
}

Fix-Encoding "js/maestra/modules/routine.js"
Fix-Encoding "js/maestra/modules/attendance.js"
Fix-Encoding "js/maestra/modules/tasks.js"
Fix-Encoding "js/maestra/modules/students.js"
Fix-Encoding "js/maestra/main.js"
Write-Host "All done."
