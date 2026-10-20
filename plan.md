# Plano — Dieguinho Entregas

## Implementação
- Reaproveitar a aplicação estática existente, mantendo o cálculo público e o visual atual.
- Carregar a configuração padrão de `data/config.json` e aplicar uma cópia editada em `localStorage`, para que o painel altere imediatamente os preços usados no site no mesmo navegador.
- Criar `admin.html` com login simples (`diego15` / senha informada), formulário de marca, Mapbox, tarifas e adicionais, além de salvar, restaurar padrão e sair.
- Manter Mapbox como primeira tentativa e OpenStreetMap/OSRM como fallback; informar claramente quando o Mapbox estiver indisponível.
- Servir os arquivos como site estático na porta 3000. Não haverá banco de dados ou servidor de autenticação nesta versão simples.

## Estrutura
- `index.html`: calculadora pública e ordem de serviço.
- `admin.html`: painel administrativo.
- `ts/main.ts` / `js/main.js`: cálculo, mapa e leitura da configuração.
- `js/admin.js`: autenticação local e edição da configuração.
- `css/styles.css` / `css/admin.css`: estilos público e administrativo.
- `data/config.json`: valores padrão/fallback.

## Design
- **Opção A (0,06):** balcão operacional verde/amarelo, aproveitando a identidade atual.
- **Opção B (0,04):** painel azul corporativo, com foco em tabelas.
- **Opção C (0,08):** dashboard escuro de despacho, com alto contraste.

### Escolhida: Opção A — balcão operacional verde/amarelo
- **Movimento:** ferramenta de operação local, direta e legível.
- **Princípios:** poucos campos, feedback imediato, valores destacados e ações reversíveis.
- **Cores:** verde transmite confiança; amarelo marca ações e totais; fundo claro reduz cansaço.
- **Layout:** navegação lateral curta e cartões de edição agrupados por assunto.
- **Assinaturas:** selo “D”, faixas amarelas e cards com borda superior.
- **Interação:** salvar mostra confirmação; restaurar exige confirmação; campos numéricos validam limites.
- **Animação:** apenas transições curtas e respeitando `prefers-reduced-motion`.
- **Tipografia:** Bricolage Grotesque para títulos e Figtree para leitura.
- **Essência:** “o preço certo antes da coleta”, para operação rápida de entregas locais.
