const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ================= CONFIGURAÇÕES DO DISCORD =================
// Crie uma aplicação em: https://discord.com/developers/applications
// Adicione em "Redirect URIs": https://SEU_SITE_NO_RENDER.onrender.com/auth/callback
const CLIENT_ID = process.env.CLIENT_ID || '1526310967238070312';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'k_yPYqeYOwS5fuh3fBf6OeWJdV_4ADIr';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://larp-0veb.onrender.com/auth/callback';

// ================= BANCO DE DADOS (MEMÓRIA) =================
const larpData = new Map();
const sessions = new Map();

function getUser(id, username, avatar) {
    if (!larpData.has(id)) {
        larpData.set(id, { id, username, avatar, larp: 50, lastLarp: 0, prisonUntil: 0, inventory: [] });
    }
    const user = larpData.get(id);
    if (username) user.username = username;
    if (avatar) user.avatar = avatar;
    return user;
}

// Middleware de Autenticação
function auth(req, res, next) {
    const sessionId = req.cookies.session_id;
    if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ error: 'Não autorizado' });
    req.userId = sessions.get(sessionId);
    next();
}

// ================= ROTAS DE AUTENTICAÇÃO =================
app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
        });

        const { id, username, avatar } = userResponse.data;
        getUser(id, username, avatar); // Registra/Atualiza
        
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        sessions.set(sessionId, id);
        res.cookie('session_id', sessionId, { maxAge: 1000 * 60 * 60 * 24 * 7 }); // 7 dias
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.send('Erro ao fazer login com o Discord.');
    }
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('session_id');
    res.json({ success: true });
});

// ================= ROTAS DA API =================
app.get('/api/me', auth, (req, res) => {
    const user = getUser(req.userId);
    res.json(user);
});

app.get('/api/leaderboard', (req, res) => {
    const sorted = [...larpData.values()].sort((a, b) => b.larp - a.larp).slice(0, 10);
    res.json(sorted);
});

app.get('/api/users', auth, (req, res) => {
    // Retorna todos os usuários exceto o próprio para a tela de roubo
    const users = [...larpData.values()]
        .filter(u => u.id !== req.userId && u.larp > 0)
        .map(u => ({ id: u.id, username: u.username, larp: u.larp, avatar: u.avatar }));
    res.json(users);
});

// Farmar Larp (.larp)
app.post('/api/larpar', auth, (req, res) => {
    const user = getUser(req.userId);
    const agora = Date.now();

    if (user.prisonUntil > agora) {
        const restante = Math.ceil((user.prisonUntil - agora) / 60000);
        return res.json({ error: `Você está na Larprisão! Aguarde ${restante} minutos.` });
    }

    const tempoRestante = 30 - Math.floor((agora - user.lastLarp) / 1000);
    if (tempoRestante > 0) return res.json({ error: `Aguarde ${tempoRestante}s para larpar novamente.` });

    const ganho = Math.floor(Math.random() * 100) + 1;
    user.larp += ganho;
    user.lastLarp = agora;
    res.json({ success: true, ganho, total: user.larp });
});

// Roubar Larp (.larpear)
app.post('/api/larpear', auth, (req, res) => {
    const { targetId } = req.body;
    const user = getUser(req.userId);
    const agora = Date.now();

    if (user.prisonUntil > agora) return res.json({ error: 'Preso não rouba! Você está na Larprisão.' });
    if (!larpData.has(targetId)) return res.json({ error: 'Alvo não encontrado.' });
    
    const alvo = larpData.get(targetId);
    if (alvo.larp <= 0) return res.json({ error: 'O alvo não tem Larp para ser roubado.' });

    if (Math.random() < 0.75) { // 75% de falhar
        user.prisonUntil = agora + (5 * 60 * 1000);
        return res.json({ success: false, prison: true, message: 'CRIME FALHOU! Você foi pego e ficará na Larprisão por 5 minutos.' });
    } else {
        const roubo = Math.max(Math.floor(alvo.larp * 0.25), 1);
        alvo.larp -= roubo;
        user.larp += roubo;
        return res.json({ success: true, roubado: roubo, total: user.larp });
    }
});

// Sincronizar apostas dos minigames (Abordagem simples para jogos client-side)
app.post('/api/sync_balance', auth, (req, res) => {
    const { bet, win } = req.body;
    const user = getUser(req.userId);
    
    if (user.prisonUntil > Date.now()) return res.json({ error: 'Você está preso, não pode apostar!' });
    if (bet > user.larp) return res.json({ error: 'Larp insuficiente.' });

    user.larp -= bet;
    user.larp += win;
    res.json({ success: true, total: user.larp });
});

// ================= INICIAR SERVIDOR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
