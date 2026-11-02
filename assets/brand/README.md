# Identidade visual e SEO

Os vetores desta pasta são a fonte de verdade para logo, favicon e cartões de
compartilhamento do ERP e do PDV. A marca principal e os cartões usam o SVG
editável completo enviado para o projeto, incluindo a faixa vermelha e o slogan.
A fonte original fica versionada em `assets/brand/logo.svg` e é publicada como
`logo.svg` nos dois apps. Os cartões identificam cada app abaixo da linha
divisória.

Os textos dos cartões usam Oswald SemiBold do Google Fonts, com os arquivos TTF
e a licença SIL Open Font License incluídos nos apps; o desenho do logotipo não
depende de fontes instaladas nem de requisições externas.

As fontes de origem e suas licenças SIL Open Font License estão em
`assets/fonts/`. Para regenerar SVG, PNG transparentes, ICO, manifestos,
`robots.txt` e `_headers` publicados pelos dois apps, execute
`pnpm assets:brand`. O ERP recebe um marcador azul no favicon; o PDV recebe o
mesmo marcador em vermelho.

Os apps exigem login. Por isso, os metadados incluem títulos, descrições,
URLs canônicas e imagens sociais, mas as páginas permanecem fora dos índices
de busca com `noindex`, `X-Robots-Tag` e `robots.txt` bloqueando o rastreamento.
