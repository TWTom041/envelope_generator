# 台灣信封產生器 Envelope Generator

輸入紙張、收寄件人資料與郵件種類，自動算出**這張紙能做出的最大信封**，產生可裁切摺疊的信封展開圖（dieline），並輸出 PDF／SVG 或直接列印。

純前端靜態網頁，不需安裝、不需伺服器端程式。

## 功能

- **紙張**：A4、A3、A5、B4、B5、Letter、Legal、Tabloid、八開、十六開，或自訂尺寸；可設定印表機邊界。
- **自動找最大尺寸**：在所有展開圖結構（側邊黏合、底部摺疊、四翼式）與紙張方向中，找出面積最大且放得下的信封。
  - 「中華郵政標準信函」模式：長 140–235 mm、寬 90–165 mm、長邊 ≥ 短邊 × 1.3。
  - 「不限」模式：做大型（非標準）信封。
  - 可指定需裝入的內容物（A4 三摺、A4 對摺、明信片…）和長寬比上限。
  - 也可改選常用尺寸（長3、DL、C5、C6…）或自訂尺寸。
- **直式（中式）**，依中華郵政書寫方式：
  - 郵票貼在左上角。
  - 收件人郵遞區號 3+3 紅框格在右上角，地址寫在右側，姓名放在中央紅框。
  - 寄件人地址、姓名寫在左下側，郵遞區號格在左下角。
- **橫式（西式）**：
  - 寄件人寫在左上角，郵票貼在右上角。
  - 收件人寫在中部偏右，底部留白。
- **郵件種類**：平信、限時（限時專送）、掛號、限時掛號、掛號附回執、快捷、印刷物、航空或自訂字樣，並可加附註（例如「請勿折疊」）。
- **稱謂、啟封詞、緘封詞**：內建建議清單與用法提示，例如 鈞啟、台啟、道啟、親啟、緘、寄。
- **直書數字**：可轉國字（122 號 → 一二二號、5-1 號 → 五之一號、3F → 三樓）、縱中橫，或直立數字。
- **輸出**：文字轉成向量輪廓，PDF 不需內嵌字型，任何閱讀器、印表機都能正確顯示。預覽、列印與 PDF 完全一致。
- **字型**：預設使用隨附的「霞鶩文楷 TC」，也可上傳自己的 .ttf／.otf／.woff，例如標楷體 kaiu.ttf。

## 使用方式

最簡單的方式是部署到 GitHub Pages：Settings → Pages → 選擇分支，開啟後就能用。

在本機執行：

```bash
npm start            # 等同 python3 -m http.server 8000
# 開啟 http://localhost:8000
```

也可以直接雙擊 `index.html`。這時瀏覽器不允許讀取本機字型檔，會改從 jsDelivr CDN 下載同一套字型；離線時請按「上傳字型」。

### 列印與製作

1. 以 **100%／實際大小** 列印，不要勾選「縮放至頁面大小」。
2. 沿實線剪下，沿虛線摺出摺痕。
3. 在灰底處塗膠黏合，裝入信件後摺下封口黏貼。

## 開發

```bash
npm test   # node --test，無任何相依套件
```

| 檔案 | 說明 |
| --- | --- |
| `js/geometry.js` | 紙張與信封規格、三種展開圖結構、最大尺寸求解 |
| `js/text.js` | 直書／橫書排版、數字轉國字、直書標點 |
| `js/layout.js` | 直式／橫式信封正面版面 |
| `js/compose.js` | 組合紙張、展開圖與正面內容 |
| `js/render.js` | 輸出 SVG（字型轉輪廓） |
| `js/pdf.js` | 極簡向量 PDF 產生器 |
| `js/fonts.js`、`js/app.js` | 字型載入與網頁介面 |

## 授權

- 程式碼：MIT（見 `LICENSE`）
- 字型：霞鶩文楷 TC（LXGW WenKai TC），SIL Open Font License 1.1（見 `fonts/OFL.txt`）
- opentype.js：MIT（見 `vendor/opentype.LICENSE`）

---

**English summary** — A static web app that generates Taiwanese envelope dielines following Chunghwa Post's standard-letter rules (140–235 × 90–165 mm, long side ≥ 1.3 × short side). It picks the largest envelope that fits the chosen paper, lays out 直式 (vertical) or 橫式 (horizontal) address faces with 3+3 postcode boxes and mail-type marks (平信／限時／掛號…), and exports vector PDF/SVG with text converted to outlines. Run `npm test` for the test suite.
