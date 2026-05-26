# 💪 PersonalPro - Gestão Inteligente de Treinos

Aplicação web para personal trainers gerenciarem o volume de treino dos alunos e acompanharem sua evolução.

## 🌐 Acesso

https://personal-trainer-app-ten.vercel.app/

## ✨ Funcionalidades

- Login separado para Personal Trainer e Aluno
- Cadastro com mensagem de confirmação e redirecionamento automático para login
- Registro de treinos com cálculo automático de volume (peso × reps)
- Preview do volume antes de salvar o treino
- Calculadora de repetições mínimas para superar o treino anterior
- Gráfico de evolução de carga por aluno
- Histórico completo com indicador de progressão (subiu, desceu ou manteve)
- Estatísticas: total de treinos, último volume, maior volume e volume acumulado

## 🧮 Fórmula de Progressão

Volume = Peso (kg) × Repetições

Reps mínimas = ceil(Volume Anterior / Peso Atual) + 1

## 🛠️ Tecnologias

- HTML, CSS e JavaScript puro
- Supabase (banco de dados e autenticação)
- Chart.js (gráficos)
- Vercel (hospedagem)

## 🚀 Como usar

1. Acesse o link da aplicação
2. Cadastre-se como Personal Trainer
3. Seus alunos acessam o mesmo link e se cadastram como Aluno
4. Registre treinos e acompanhe a evolução de cada aluno

## 👨‍💻 Desenvolvido por

caiozdev - Estudante de ADS na PUC Goiás