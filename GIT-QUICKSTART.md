# Git — primeiro envio

Depois de criar no GitHub o repositório privado `Guidoka7/sra-luck-dev-console`, abra o terminal dentro desta pasta.

## 1. Iniciar o Git

Este comando transforma a pasta local em um repositório Git:

```bash
git init
```

## 2. Definir `main`

Este comando garante que a branch principal se chame `main`:

```bash
git branch -M main
```

## 3. Conferir arquivos

Este comando mostra o que será controlado pelo Git e ajuda a confirmar que nenhum `.env` real entrou:

```bash
git status
```

## 4. Validar antes do commit

Este comando executa as verificações usadas pelo CI:

```bash
npm run check
```

## 5. Adicionar os arquivos

```bash
git add .
```

## 6. Criar o primeiro commit

```bash
git commit -m "feat: bootstrap Sra Luck Dev Console"
```

## 7. Conectar ao GitHub

```bash
git remote add origin https://github.com/Guidoka7/sra-luck-dev-console.git
```

## 8. Enviar para a `main`

```bash
git push -u origin main
```

Depois confirme no GitHub se o workflow `Validate Dev Console` ficou verde.
