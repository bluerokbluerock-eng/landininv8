LANDINGV8 — RECOVERYADVISORY

Vista local
Abre index.html para revisar el diseño o ejecuta node server.mjs con Node 24
y abre http://localhost:8080. El frontend usa HTML, CSS y JavaScript sin
dependencias de ejecución ni compilación.

Formulario
Copia .env.example a .env y ejecuta node --env-file=.env server.mjs.
Configura CRM_BACKEND_URL con la URL base del CRM y CRM_LANDING_API_KEY
con una clave privada de al menos 32 caracteres, igual en la landing y crm-api.
El servidor envía la solicitud a POST /api/v1/leads/landingv8 y muestra la
confirmación cuando el CRM guarda el registro. La fecha de nacimiento es
opcional y el consentimiento es obligatorio.

Los nuevos leads se guardan en Retenciones (área 1), la campaña 27
y el estado inicial 38. Aparecen en Leads Metrics según los permisos del CRM.
El CRM utiliza el mismo landingRequestId e índice único de landingv7 para
evitar registros duplicados al reintentar.

Railway
Configura el servicio con el Dockerfile de la raíz y /railway.json. Declara
CRM_BACKEND_URL y CRM_LANDING_API_KEY en las variables del servicio.

Meta Pixel y API de conversiones
El píxel 1101059396141011 registra PageView al cargar. El navegador registra
CompleteRegistration después de que el CRM confirma el alta. El píxel y CAPI
usan el mismo nombre de evento y el identificador landingv8-lead-<requestId>
para que Meta deduplique ambas señales.

Define META_CAPI_ACCESS_TOKEN como secreto en el servicio de esta landing en
Railway. El servidor de la landing envía CompleteRegistration a Meta después
de recibir la confirmación del endpoint del CRM. El envío usa datos de atribución
del navegador cuando están disponibles. Los errores transitorios se reintentan
una vez y se registran sin incluir credenciales ni datos del visitante.

Recursos
Foto del ZIP: Unsplash, photo-1758518729908-d4220a678d81.
Fuentes y licencias locales en assets/fonts y assets/licenses.
