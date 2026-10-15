# Long-running OS input server for the recorder: the real Windows cursor, real
# mouse buttons and wheel, and real keystrokes.
#
# Playwright's page.mouse and page.keyboard dispatch synthetic events straight
# into the renderer, so the Windows cursor never moves and a screen recording
# shows a frozen pointer while the page reacts by itself. This moves the real
# one. Adapted from the provider-ops recorder, without its file-dialog commands.
#
# Reads one command per line on stdin and prints OK (or ERR <message>) per
# command, so the caller can await each one in order.
#
#   MOVE <x> <y>      move the cursor to screen coordinates
#   DOWN | UP         left mouse button
#   WHEEL <delta>     mouse wheel; positive scrolls down, 120 per notch
#   TYPE <base64>     type UTF-8 text (base64 to survive the line protocol)
#   KEY <ENTER|ESC|TAB|BACKSPACE>
#   CHORD <keys>      a key with modifiers, e.g. CTRL+SHIFT+V, CTRL+G, SHIFT+DOWN
#   FOCUS             bring the browser this harness launched to the foreground
#   FOCUSTITLE <b64>  bring the window whose title contains this text to the foreground
#   MAXTITLE <b64>    maximize the window whose title contains this text
#   PING

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class OsInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, uint pvParam, uint fWinIni);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder buf, int n);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    const string BROWSER_CLASS = "Chrome_WidgetWin_1";
    const int SW_RESTORE = 9;

    // Edge, Slack, Teams and VS Code are all Chromium with the same window
    // class, so the class alone would happily focus somebody's mail client.
    // The browser Playwright launched runs from its ms-playwright folder.
    static bool IsLaunchedBrowser(IntPtr h) {
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        try {
            var path = System.Diagnostics.Process.GetProcessById((int)pid).MainModule.FileName;
            return path != null && path.IndexOf("ms-playwright", StringComparison.OrdinalIgnoreCase) >= 0;
        } catch {
            return false;
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder buf, int n);

    static IntPtr FindWindow(Func<IntPtr, bool> matches) {
        IntPtr ours = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
            var cls = new System.Text.StringBuilder(256);
            GetClassName(h, cls, 256);
            if (cls.ToString() != BROWSER_CLASS || !matches(h)) return true;
            ours = h;
            return false;
        }, IntPtr.Zero);
        return ours;
    }

    public static IntPtr FindLaunchedBrowser() {
        return FindWindow(IsLaunchedBrowser);
    }

    // The presentation's VS Code window is told apart from the user's own by
    // a marker its window.title setting always carries.
    public static IntPtr FindWindowByTitle(string marker) {
        return FindWindow(delegate(IntPtr h) {
            var title = new System.Text.StringBuilder(512);
            GetWindowText(h, title, 512);
            return title.ToString().IndexOf(marker, StringComparison.Ordinal) >= 0;
        });
    }

    // Windows only lets the current foreground process hand focus away.
    // Attaching to the foreground thread's input state is the documented way
    // across that boundary; SwitchToThisWindow (what Alt-Tab uses) covers the
    // case where the handoff is still refused.
    public static bool FocusBrowser() {
        return FocusWindow(FindLaunchedBrowser());
    }

    public static bool FocusWindow(IntPtr h) {
        if (h == IntPtr.Zero) return false;
        if (GetForegroundWindow() == h) return true;
        IntPtr fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
        uint ourThread = GetCurrentThreadId();
        bool attached = fgThread != ourThread && AttachThreadInput(ourThread, fgThread, true);
        try {
            ShowWindow(h, SW_RESTORE);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if (GetForegroundWindow() != h) SwitchToThisWindow(h, true);
        } finally {
            if (attached) AttachThreadInput(ourThread, fgThread, false);
        }
        System.Threading.Thread.Sleep(150);
        return GetForegroundWindow() == h;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUT_UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUT_UNION u; }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    static void Send(INPUT[] inputs) {
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Mouse(uint flags, uint data) {
        INPUT[] i = new INPUT[1];
        i[0].type = INPUT_MOUSE;
        i[0].u.mi.dwFlags = flags;
        i[0].u.mi.mouseData = data;
        Send(i);
    }

    public static void MouseDown() { Mouse(MOUSEEVENTF_LEFTDOWN, 0); }
    public static void MouseUp() { Mouse(MOUSEEVENTF_LEFTUP, 0); }

    // Windows' wheel delta is positive for "away from the user" (scroll up).
    public static void Wheel(int downPixels) { Mouse(MOUSEEVENTF_WHEEL, unchecked((uint)(-downPixels))); }

    // Unicode injection, so punctuation never depends on the keyboard layout.
    public static void TypeChar(char c) {
        INPUT[] i = new INPUT[2];
        i[0].type = INPUT_KEYBOARD;
        i[0].u.ki.wScan = (ushort)c;
        i[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
        i[1] = i[0];
        i[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        Send(i);
    }

    public static void KeyVk(ushort vk) {
        INPUT[] i = new INPUT[2];
        i[0].type = INPUT_KEYBOARD;
        i[0].u.ki.wVk = vk;
        i[1] = i[0];
        i[1].u.ki.dwFlags = KEYEVENTF_KEYUP;
        Send(i);
    }

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    // Arrows, Home, End, Page Up/Down, Insert and Delete share scan codes with
    // the numeric keypad; without the extended flag Shift+Down can arrive as
    // keypad 2 and select nothing.
    static bool IsExtended(ushort vk) {
        return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E;
    }

    static INPUT KeyEvent(ushort vk, bool up) {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk;
        i.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
        return i;
    }

    // Modifiers down in order, the key down and up, modifiers up in reverse.
    public static void Chord(ushort[] modifiers, ushort vk) {
        var events = new System.Collections.Generic.List<INPUT>();
        foreach (var m in modifiers) events.Add(KeyEvent(m, false));
        events.Add(KeyEvent(vk, false));
        events.Add(KeyEvent(vk, true));
        for (int n = modifiers.Length - 1; n >= 0; n--) events.Add(KeyEvent(modifiers[n], true));
        Send(events.ToArray());
    }
}
"@

# SPI_SETFOREGROUNDLOCKTIMEOUT = 0, for this session only (no SPIF_UPDATEINIFILE),
# so Windows stops refusing a foreground switch from a background process.
[void][OsInput]::SystemParametersInfo(0x2001, 0, 0, 0)

$VK = @{ "ENTER" = 0x0D; "ESC" = 0x1B; "TAB" = 0x09; "BACKSPACE" = 0x08 }

# Keys a CHORD can name. Letters and digits are their own virtual-key codes.
$CHORD_VK = @{
    "ENTER" = 0x0D; "ESC" = 0x1B; "TAB" = 0x09; "BACKSPACE" = 0x08; "SPACE" = 0x20; "DELETE" = 0x2E
    "PGUP" = 0x21; "PGDN" = 0x22; "END" = 0x23; "HOME" = 0x24
    "LEFT" = 0x25; "UP" = 0x26; "RIGHT" = 0x27; "DOWN" = 0x28
    "COMMA" = 0xBC; "PERIOD" = 0xBE; "SLASH" = 0xBF; "BACKSLASH" = 0xDC; "BACKTICK" = 0xC0
}
$MODIFIER_VK = @{ "CTRL" = 0x11; "SHIFT" = 0x10; "ALT" = 0x12 }

function Get-ChordVk([string]$name) {
    if ($CHORD_VK.ContainsKey($name)) { return [uint16]$CHORD_VK[$name] }
    if ($name -match '^[A-Z0-9]$') { return [uint16][char]$name }
    if ($name -match '^F([1-9]|1[0-2])$') { return [uint16](0x6F + [int]$Matches[1]) }
    throw "Unknown key: $name"
}

# The gap before the next keystroke: a bell curve around a typical speed, a
# longer gap at word and sentence boundaries, and an occasional hesitation.
function Get-KeystrokeDelayMs([char]$ch) {
    $u1 = Get-Random -Minimum 0.0001 -Maximum 1.0
    $u2 = Get-Random -Minimum 0.0001 -Maximum 1.0
    $gauss = [Math]::Sqrt(-2.0 * [Math]::Log($u1)) * [Math]::Cos(2.0 * [Math]::PI * $u2)
    $delay = 48 + ($gauss * 16)
    if ($ch -eq ' ') {
        $delay += Get-Random -Minimum 20 -Maximum 70
    } elseif ($ch -match '[.,!?;:]') {
        $delay += Get-Random -Minimum 50 -Maximum 130
    }
    if ((Get-Random -Minimum 0.0 -Maximum 1.0) -lt 0.03) {
        $delay += Get-Random -Minimum 180 -Maximum 380
    }
    return [int]([Math]::Max(20, [Math]::Min($delay, 600)))
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq "") { continue }

    try {
        $parts = $line.Split(" ", 2)
        switch ($parts[0]) {
            "MOVE" {
                $xy = $parts[1].Split(" ")
                [void][OsInput]::SetCursorPos([int]$xy[0], [int]$xy[1])
            }
            "DOWN" { [OsInput]::MouseDown() }
            "UP" { [OsInput]::MouseUp() }
            "WHEEL" { [OsInput]::Wheel([int]$parts[1]) }
            "TYPE" {
                $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
                foreach ($ch in $text.ToCharArray()) {
                    [OsInput]::TypeChar($ch)
                    Start-Sleep -Milliseconds (Get-KeystrokeDelayMs $ch)
                }
            }
            "KEY" {
                $name = $parts[1].Trim().ToUpper()
                if (-not $VK.ContainsKey($name)) { throw "Unknown key: $name" }
                [OsInput]::KeyVk([uint16]$VK[$name])
            }
            "CHORD" {
                $names = $parts[1].Trim().ToUpper().Split("+")
                $modifiers = @()
                for ($n = 0; $n -lt $names.Length - 1; $n++) {
                    if (-not $MODIFIER_VK.ContainsKey($names[$n])) { throw "Unknown modifier: $($names[$n])" }
                    $modifiers += [uint16]$MODIFIER_VK[$names[$n]]
                }
                [OsInput]::Chord([uint16[]]$modifiers, (Get-ChordVk $names[-1]))
            }
            "FOCUSTITLE" {
                $marker = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
                $focused = $false
                for ($attempt = 1; $attempt -le 5 -and -not $focused; $attempt++) {
                    $focused = [OsInput]::FocusWindow([OsInput]::FindWindowByTitle($marker))
                    if (-not $focused -and $attempt -lt 5) { Start-Sleep -Milliseconds 300 }
                }
                if (-not $focused) { throw "Could not bring the window titled '*$marker*' to the foreground" }
                Start-Sleep -Milliseconds 250
            }
            "MAXTITLE" {
                $marker = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
                $h = [OsInput]::FindWindowByTitle($marker)
                if ($h -eq [IntPtr]::Zero) { throw "No window titled '*$marker*'" }
                [void][OsInput]::ShowWindow($h, 3)  # SW_MAXIMIZE
                Start-Sleep -Milliseconds 400
            }
            "FOCUS" {
                # The handoff can lose a race with whatever just changed the
                # foreground; a few quick retries clear that without hiding a
                # real "no browser window" failure.
                $focused = $false
                for ($attempt = 1; $attempt -le 5 -and -not $focused; $attempt++) {
                    $focused = [OsInput]::FocusBrowser()
                    if (-not $focused -and $attempt -lt 5) { Start-Sleep -Milliseconds 300 }
                }
                if (-not $focused) {
                    if ([OsInput]::FindLaunchedBrowser() -eq [IntPtr]::Zero) {
                        throw "No visible window from the Playwright-launched browser"
                    }
                    throw "Windows refused the foreground after 5 attempts"
                }
                Start-Sleep -Milliseconds 250
            }
            "PING" { }
            default { throw "Unknown command: $($parts[0])" }
        }
        [Console]::Out.WriteLine("OK")
    }
    catch {
        [Console]::Out.WriteLine("ERR $($_.Exception.Message -replace '\r?\n', ' ')")
    }
    [Console]::Out.Flush()
}
