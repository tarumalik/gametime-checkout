const { createApp } = require('./app');

const PORT = Number(process.env.PORT ?? 4000);
createApp().listen(PORT, () => console.log(`Mock payments API on http://localhost:${PORT}`));
