# AgentProxy Features Guide

Complete documentation of all features in AgentProxy v0.3+

---

## 🎨 **1. Theme System (Dark/Light Mode)**

### Location
Settings section → **Theme** dropdown

### Options
- **Dark** (default): Dark background (#101418), light text
- **Light**: Light background (#fafbfc), dark text

### Features
- ✅ Instant theme switching (no reload needed)
- ✅ Preference saved to localStorage
- ✅ Auto-load saved theme on startup
- ✅ Full CSS variable support for easy customization

### Keyboard Shortcut
None (use dropdown or change `localStorage.agentproxy-theme`)

---

## 🔄 **2. Proxy Batch Operations**

### Location
Above proxy table → **Checkbox selection** + **Batch buttons**

### How to Use
1. Click checkbox next to proxy rows to select
2. Use **Select All** checkbox (top-left) to select/deselect all
3. Selected count shown: "N selected"
4. Batch action buttons appear when items selected

### Operations

#### **⟳ Rotate Selected**
- Get new exit IPs for all selected proxies
- **Cost**: 1 reset per proxy
- **Speed**: 200ms delay between rotations
- **Status**: Toast notification when done

#### **📋 Copy Selected**
- Copy all selected proxy addresses to clipboard
- Format: one proxy per line (e.g., `127.0.0.1:8801`)
- **Status**: "✓ Copied!" toast for 1.5 seconds

### Keyboard Shortcuts
None (use checkboxes)

---

## 💾 **3. Settings Backup & Restore**

### Location
Settings section → **Export** / **Import** buttons

### What Gets Backed Up
- Bind IP, Port range, Count, MCP port
- Rotation Strategy, Health Check Interval, Quota Alert
- Current Theme, Current Language
- Export timestamp (for reference)

### Export Settings
1. Click **⬇ Export** button
2. File downloaded: `agentproxy-settings-{timestamp}.json`
3. Toast: "✓ Settings exported"
4. Share/backup JSON file anywhere

### Import Settings
1. Click **⬆ Import** button
2. Select `.json` file from your computer
3. All settings restored (theme + language too)
4. Toast: "✓ Settings imported successfully"

### Use Cases
- 💾 Backup before major changes
- 🔄 Sync settings across multiple machines
- 👥 Share optimal config with team
- 🔙 Quick rollback if something breaks

### Error Handling
- Invalid JSON: "❌ Invalid file: ..."
- Import fails: "❌ Import failed: ..."
- Errors cleared after 3 seconds

---

## 🌍 **4. Multi-Language Support (7 Languages)**

### Location
Settings section → **Language** dropdown

### Supported Languages
1. 🇬🇧 **English** (default)
2. 🇻🇳 **Tiếng Việt** (Vietnamese)
3. 🇨🇳 **中文** (Simplified Chinese)
4. 🇯🇵 **日本語** (Japanese)
5. 🇰🇷 **한국어** (Korean)
6. 🇪🇸 **Español** (Spanish)
7. 🇫🇷 **Français** (French)

### Features
- ✅ Instant language switching (no reload)
- ✅ Preference saved to localStorage
- ✅ Auto-load saved language on startup
- ✅ English fallback for missing translations
- ✅ All UI elements translated (buttons, labels, messages)

### Architecture
- **English Base**: HTML kept in English, fallback for all languages
- **Easy Scaling**: Adding new language = just copy en.json, translate values
- **No HTML Changes**: Language switching doesn't require HTML edits

### Add New Language
```json
// Copy renderer/locales/en.json → renderer/locales/xx.json
// Translate all values, keep keys the same
// Add to language dropdown in index.html
```

---

## ✨ **5. Enhanced UI/UX**

### Toast Notifications
- **What**: Small pop-up messages (bottom-right)
- **Where**: Feedback for actions (export, import, reload, etc.)
- **Auto-dismiss**: After 3 seconds (customizable)
- **Mobile**: Full-width on screens < 768px

### Responsive Design
- ✅ Works on desktop, tablet, mobile
- **Breakpoint**: 768px width
- Stacked layout on mobile
- Font sizes adjusted for readability

### Status Indicators (CSS Ready)
- 🟢 `.status-online`: Green (healthy)
- 🔴 `.status-offline`: Red (down)
- 🟡 `.status-warning`: Yellow (degraded)

*Currently prepared in CSS, ready to be used in proxy status display*

---

## 🔄 **6. Reload Options (Bonus Feature)**

### Location
Main section → **Reload** dropdown + **🔄 Reload** button

### Reload Modes

#### **Soft (Ctrl+R)** ⚡ Recommended for dev
- **What**: Reloads UI only (`location.reload()`)
- **Proxy Status**: Continues running (no interruption)
- **Use Case**: Quick dev refresh, test UI changes
- **Speed**: Instant

#### **Full (Ctrl+Shift+R)** 🔁 Clean restart
- **What**: Full app restart (`app.relaunch()`)
- **Proxy Status**: Disconnects & reconnects
- **Use Case**: Clean state, if something's stuck
- **Speed**: ~2-3 seconds

#### **Hot Module (Ctrl+Alt+R)** 🔥 Dev mode only
- **What**: Auto-reload on file changes (`electron-reload`)
- **Requirements**: Optional `electron-reload` package
- **Use Case**: Active development
- **Status**: "Hot reload enabled" or "Not supported in this build"

### How to Use
1. Open **Reload** dropdown
2. Select mode: Soft / Full / Hot Module
3. Click **🔄 Reload** button (or use keyboard shortcut)
4. Toast notification appears with reload status

### Keyboard Shortcuts
| Shortcut | Mode | Effect |
|----------|------|--------|
| **Ctrl+R** | Soft | UI reload only |
| **Ctrl+Shift+R** | Full | Full app restart |
| **Ctrl+Alt+R** | Hot | Dev auto-reload |

### When to Use Each
- **Soft**: Testing UI changes, quick refresh
- **Full**: Settings changed, fresh start needed
- **Hot**: Active development (file watching)

---

## 📋 **Settings Reference**

### Rotation Strategy
- **Manual**: Click button for each proxy
- **Auto on failures**: Auto rotate when proxy fails 3+ times
- **Auto on slow**: Auto rotate when latency > 500ms
- **Auto on both**: Both conditions trigger rotation

### Health Check Interval
- **Per request**: Check health on every request
- **Every 1/5/10 minutes**: Periodic checks
- **Manual only**: Never auto-check, check on demand

### Quota Alert Threshold
- **50%, 70%, 80%, 90%**: Alert when quota usage exceeds %
- **Never alert**: Disable quota warnings

---

## 🎮 **Quick Reference - All Buttons & Shortcuts**

| Button | Location | Shortcut | Function |
|--------|----------|----------|----------|
| **Reload** | Header | - | Refresh allocation from backend |
| **Connect/Disconnect** | Header | - | Start/stop proxy service |
| **Save** | Settings | - | Save all settings |
| **Export** | Settings | - | Download settings backup |
| **Import** | Settings | - | Restore settings from file |
| **🔄 Reload** | Main | Ctrl+R/Shift+R/Alt+R | Soft/Full/Hot reload |
| **📋 Logs** | Main | - | Show/hide console |
| **🧹 Clear** | Main | - | Clear log history |
| **Select All** | Table | - | Select/deselect all proxies |
| **⟳ Rotate** | Table (batch) | - | Rotate selected proxies |
| **📋 Copy** | Table (batch) | - | Copy selected IPs |
| **⟳ Rotate** | Table (single) | - | Rotate single proxy |
| **📋 Copy** | Table (single) | - | Copy single IP |

---

## 💡 **Pro Tips**

1. **Batch Operations**: Use checkboxes to rotate 5+ proxies at once (saves time)
2. **Settings Backup**: Export settings before testing, import to rollback
3. **Theme for Eyes**: Switch to Light mode during day, Dark at night
4. **Language**: Set to your native language for easier use
5. **Soft Reload**: Use Ctrl+R during development (fastest feedback)
6. **Logs**: Toggle logs off to reduce CPU usage if not debugging

---

## 🐛 **Troubleshooting**

### Theme not saving?
- Check if localStorage is enabled in browser
- Try exporting settings, then importing fresh

### Language reverts to English?
- localStorage might be cleared
- Use Export to backup language preference

### Batch operations not showing?
- Select at least 1 proxy checkbox
- Buttons appear automatically

### Reload not working?
- Soft: Always works, just refreshes UI
- Full: Requires app restart capability
- Hot: Requires `electron-reload` package installed

### Settings import fails?
- Verify JSON is valid (no syntax errors)
- Check all required keys are present
- Use a previously exported file as template

---

**Last Updated**: 2026-11-05  
**Version**: 0.3+  
**Total Features**: 6 (5 major + 1 bonus)
