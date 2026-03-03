# CAD Viewer (STL / OBJ)

可部署在 Vercel 的簡易 CAD 檢視器，支援上傳並瀏覽 `.stl` 與 `.obj` 檔案。

## 功能

- 上傳 STL / OBJ 模型
- Three.js 3D 檢視（旋轉 / 縮放 / 平移）
- 自動聚焦模型

## 本機開發

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

## 部署到 Vercel

1. 將專案推上 GitHub。
2. 到 Vercel 匯入該 repository。
3. Framework Preset 選擇 `Vite`（通常會自動偵測）。
4. Build Command: `npm run build`、Output Directory: `dist`。

完成後 Vercel 會自動產生網址。
