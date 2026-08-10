const express = require('express')
const app = express().use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', 
    "default-src 'self' https://neo4j.com/ https://dist.neo4j.com/; " +
    "script-src 'self' 'unsafe-inline' https://neo4j.com/; " +
    "style-src 'self' 'unsafe-inline' https://neo4j.com https://fonts.googleapis.com/; " +
    "font-src 'self' https://storage.googleapis.com/neo4j-fonts/ https://neo4j.com/ https://fonts.gstatic.com;"
  );
  next();
});

app.use(express.static('./build/site'))

app.use('/static/assets', express.static('./build/site/assets'))

app.get('/', (req, res) => res.redirect('/docs/'))

app.listen(8000, () => console.log('📘 http://localhost:8000'))