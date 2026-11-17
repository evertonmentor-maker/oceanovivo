# Oceano Vivo 🌊

MVP de monitoramento da balneabilidade e da poluição das praias de Santa Catarina.

## Como rodar

```bash
npm install
npm start
```

- Site: http://localhost:3000
- Área restrita: http://localhost:3000/admin (usuário `admin`, senha `oceanovivo2026`)

## Configuração (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `ADMIN_USER` | `admin` | Usuário da área restrita |
| `ADMIN_PASSWORD` | `oceanovivo2026` | Senha da área restrita (**troque em produção**) |
| `SESSION_SECRET` | aleatório a cada início | Chave que assina o cookie de sessão. Defina um valor fixo para o login sobreviver a reinícios |
| `GOOGLE_MAPS_API_KEY` | vazio | Chave da Maps JavaScript API. Sem ela, o mapa usa OpenStreetMap |

Exemplo (PowerShell):

```powershell
$env:GOOGLE_MAPS_API_KEY="sua-chave"; $env:ADMIN_PASSWORD="outra-senha"; npm start
```

## Funcionalidades

- **Mapa** (Google Maps ou OpenStreetMap) com as praias coloridas pela situação: própria, imprópria ou sem dados.
- **Busca e filtros** por nome, município e situação.
- **Ficha da praia**: situação, E. coli, coliformes termotolerantes e enterococos comparados aos limites da
  CONAMA 274/2000, condições observadas (lixo, esgoto, óleo, algas, águas-vivas), histórico de coletas e
  links "Abrir no Google Maps" e "Como chegar".
- **Tempo e mar** via [Open-Meteo](https://open-meteo.com) (gratuito, sem chave): temperatura, vento, UV,
  altura e período das ondas, temperatura da água, previsão de 3 dias e alerta de chuva nas últimas 24 h.
- **ONGs** que atuam pelo oceano (editáveis em `data/ongs.json`).
- **Área restrita**: cadastro, edição e exclusão de praias e de boletins, com sugestão automática da situação
  a partir dos indicadores.

## Dados

- `data/seed.json`: carga inicial com 18 praias reais de SC. **Os boletins são fictícios**, só para
  demonstração. Substitua pelos laudos oficiais do IMA-SC (https://balneabilidade.ima.sc.gov.br).
- `data/db.json`: banco em uso, criado a partir do seed no primeiro início. Apague-o para voltar ao estado inicial.
