# Control de Cirugías Oftalmológicas
**Centro de Ojos Esteves**

Sistema web de gestión de cirugías. Funciona completamente en frontend.
**Stack:** HTML + CSS + JavaScript (ES Modules) + Firebase Firestore + GitHub Pages

---

## Estructura del proyecto

```
/
├── index.html              # Estructura HTML principal (solo contenedores)
├── importar_datos.html     # Herramienta de importación masiva
├── css/
│   └── styles.css          # Todos los estilos
├── js/
│   ├── firebase.js         # Inicialización Firebase + cola offline
│   ├── utils.js            # escapeHtml, escapeAttr, fechas, IDB, toast
│   ├── state.js            # Estado global, lógica de negocio, alertas
│   ├── render.js           # Render: tabla, panel lateral, kanban, calendario
│   ├── firebase-ui.js      # Sincronización Firestore, guardado, caché
│   ├── connector.js        # Conector local OPCIONAL (sin polling automático)
│   ├── estadisticas.js     # Dashboard estadísticas (lazy, carga Chart.js)
│   ├── whatsapp.js         # Módulo WhatsApp
│   ├── importer.js         # Importación masiva a Firestore
│   └── app.js              # Punto de entrada, eventos, acciones
├── firestore.rules         # Reglas de seguridad Firestore
└── CNAME                   # Dominio para GitHub Pages
```

---

## Decisiones de arquitectura

### Seguridad HTML
Todos los datos de usuario pasan por `escapeHtml()` o `escapeAttr()` antes de
insertarse en el DOM. Esto previene roturas de UI con comillas, apóstrofes y
caracteres especiales.

### Sin eventos inline
Los botones en el HTML usan `id=` en lugar de `onclick=`. Los eventos se
registran con `addEventListener` en `app.js`.

### Conector local
El health-check del conector **nunca** se ejecuta automáticamente.
Solo se activa cuando el usuario presiona el badge del conector.

### Módulos lazy
`estadisticas.js` y `whatsapp.js` se cargan dinámicamente solo cuando el
usuario navega a esas pestañas.

---

## Publicar en GitHub Pages

1. Crear un repositorio en GitHub
2. Subir todos los archivos al repositorio
3. Ir a Settings → Pages → Source: `main` branch, carpeta `/`
4. La app estará disponible en `https://[usuario].github.io/[repo]/`

## Configurar Firebase

La configuración de Firebase está en `js/firebase.js`.
Para usar tu propio proyecto, reemplazá el objeto `firebaseConfig`.

