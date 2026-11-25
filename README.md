# Curvas de Nível

App web (PWA) para **desenhar um polígono sobre a imagem de satélite e gerar as curvas de nível dentro dele**.
Funciona no navegador do PC e do celular, sem instalar nada e sem chave de API.

## Como usar
1. Toque em **Desenhar polígono** e marque os vértices no mapa (ou **Importar** um KML/GeoJSON).
2. Toque no primeiro ponto ou em **Concluir**. Os vértices podem ser arrastados.
3. Escolha a **equidistância**, a **curva mestra** e a **suavização** → **Gerar curvas**.
4. Toque no mapa para ver a altitude de um ponto.
5. Exporte em **KML**, **GeoJSON**, **DXF** (SIRGAS 2000 / UTM, POLYLINE 3D com a cota em Z, camadas de mestras, intermediárias, polígono e cotas) ou **CSV** com os pontos XYZ do modelo.

## Dados
- **Imagem:** Esri World Imagery (só visual).
- **Altitudes:** [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium). No Brasil vêm principalmente do **SRTM de ~30 m**.
  - Precisão vertical de alguns metros; mede o topo da vegetação e das construções (MDS).
  - Serve para estudos preliminares, croquis e planejamento. **Não substitui levantamento topográfico.**

## Como funciona
- Baixa os tiles de altitude que cobrem o polígono (zoom automático até 15, ~4 m/pixel), decodifica as cores em metros e monta um grid.
- Suaviza o grid (filtro gaussiano) para tirar o "degrau" do SRTM.
- Gera as isolinhas com *marching squares*, recorta exatamente no polígono, junta os segmentos em linhas e simplifica (Douglas-Peucker).
- O cálculo fica em `curvas.js` (sem dependências); a interface usa Leaflet.

## Publicar no GitHub Pages
Envie `index.html`, `curvas.js`, `sw.js`, `manifest.webmanifest` e `icon.svg` para a raiz do repositório e ative
**Settings → Pages → Deploy from a branch → main / (root)**.
