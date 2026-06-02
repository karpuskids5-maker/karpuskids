# Fix double-encoded UTF-8 in maestra JS files
# Uses byte-level encoding to avoid PS script encoding issues
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Fix-File($path) {
    if (-not (Test-Path $path)) { Write-Host "SKIP: $path"; return }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $text = $utf8.GetString($bytes)
    $orig = $text

    # Each corrupted sequence: original UTF-8 bytes were read as Windows-1252/Latin-1
    # then re-encoded as UTF-8, creating 2-3 byte sequences per original char.
    # We decode that wrong UTF-8 as Latin-1 to recover original bytes, then decode as UTF-8.
    
    # Build replacement table using byte arrays to avoid PS encoding issues
    # Format: [wrong_bytes_as_utf8] -> [correct_utf8_bytes]
    
    # n with tilde (n + tilde = U+00F1 = C3 B1 in UTF-8)
    # Double-encoded: C3 83 C2 B1 in UTF-8 = "Ã±" in Latin-1 view
    $wrong  = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xB1))  # ÃƒÂ±
    $right  = $utf8.GetString([byte[]](0xC3,0xB1))             # ñ
    $text = $text.Replace($wrong, $right)
    
    # e acute U+00E9 = C3 A9
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xA9))
    $right = $utf8.GetString([byte[]](0xC3,0xA9))
    $text = $text.Replace($wrong, $right)
    
    # o acute U+00F3 = C3 B3
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xB3))
    $right = $utf8.GetString([byte[]](0xC3,0xB3))
    $text = $text.Replace($wrong, $right)
    
    # a acute U+00E1 = C3 A1
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xA1))
    $right = $utf8.GetString([byte[]](0xC3,0xA1))
    $text = $text.Replace($wrong, $right)
    
    # i acute U+00ED = C3 AD
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xAD))
    $right = $utf8.GetString([byte[]](0xC3,0xAD))
    $text = $text.Replace($wrong, $right)
    
    # u acute U+00FA = C3 BA
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0xBA))
    $right = $utf8.GetString([byte[]](0xC3,0xBA))
    $text = $text.Replace($wrong, $right)
    
    # U acute U+00DA = C3 9A
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC5,0xA1))
    $right = $utf8.GetString([byte[]](0xC3,0x9A))
    $text = $text.Replace($wrong, $right)
    
    # A acute U+00C1 = C3 81
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0x81))
    $right = $utf8.GetString([byte[]](0xC3,0x81))
    $text = $text.Replace($wrong, $right)
    
    # E acute U+00C9 = C3 89
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC2,0x89))
    $right = $utf8.GetString([byte[]](0xC3,0x89))
    $text = $text.Replace($wrong, $right)
    
    # N tilde U+00D1 = C3 91
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xE2,0x80,0x98))
    $right = $utf8.GetString([byte[]](0xC3,0x91))
    $text = $text.Replace($wrong, $right)
    
    # O acute U+00D3 = C3 93
    $wrong = $utf8.GetString([byte[]](0xC3,0x83,0xC5,0x94))
    $right = $utf8.GetString([byte[]](0xC3,0x93))
    $text = $text.Replace($wrong, $right)
    
    # inverted exclamation U+00A1 = C2 A1
    $wrong = $utf8.GetString([byte[]](0xC3,0x82,0xC2,0xA1))
    $right = $utf8.GetString([byte[]](0xC2,0xA1))
    $text = $text.Replace($wrong, $right)
    
    # inverted question U+00BF = C2 BF
    $wrong = $utf8.GetString([byte[]](0xC3,0x82,0xC2,0xBF))
    $right = $utf8.GetString([byte[]](0xC2,0xBF))
    $text = $text.Replace($wrong, $right)
    
    # solo C3 82 residual (U+00C2 misread) -> remove
    $wrong = $utf8.GetString([byte[]](0xC3,0x82))
    $text = $text.Replace($wrong, "")
    
    # Fix 4-byte emoji sequences that got double-encoded
    # These are F0 9F XX YY sequences (emoji) that became C3 B0 C5 B8 ...
    # Example: 😊 = F0 9F 98 8A -> double-encoded mess
    # Replace all remaining Ã°Å¸ patterns (0xC3 0xB0 0xC5 0xB8) with correct emoji base
    # We'll replace the corrupted emoji patterns with clean text alternatives
    $emojiBase = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8))
    if ($text.Contains($emojiBase)) {
        # Replace full corrupted emoji patterns with Unicode emoji
        # 😊 feliz
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xCB,0x9C,0xC3,0x85))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F60A))
        # 😐 normal  
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xCB,0x9C,0xC2,0x90))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F610))
        # 😢 triste
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xCB,0x9C,0xC2,0xA2))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F622))
        # 😡 enojado
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xCB,0x9C,0xC2,0xA1))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F621))
        # 💤 sleep
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xE2,0x80,0x99,0xC2,0xA4))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F4A4))
        # 🍽 food
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xC2,0x8D,0xC2,0xBD))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F37D))
        # 🍼 baby bottle
        $bad = $utf8.GetString([byte[]](0xC3,0xB0,0xC5,0xB8,0xC2,0x8D,0xC2,0xBC))
        $text = $text.Replace($bad, [System.Char]::ConvertFromUtf32(0x1F37C))
        # Remove any remaining C3 B0 C5 B8 garbage sequences
        while ($text.Contains($emojiBase)) {
            $idx = $text.IndexOf($emojiBase)
            $end = [Math]::Min($idx + 8, $text.Length)
            $text = $text.Remove($idx, $end - $idx).Insert($idx, "?")
        }
    }

    if ($text -ne $orig) {
        [System.IO.File]::WriteAllBytes($path, $utf8.GetBytes($text))
        Write-Host "FIXED: $path"
    } else {
        Write-Host "UNCHANGED: $path"
    }
}

Fix-File "js/maestra/modules/routine.js"
Fix-File "js/maestra/modules/attendance.js"
Fix-File "js/maestra/modules/tasks.js"
Fix-File "js/maestra/modules/students.js"
Fix-File "js/maestra/main.js"
Write-Host "All done."
