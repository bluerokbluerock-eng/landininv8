LANDINGV8 — RECOVERYADVISORY

Vista local
Abre index.html para revisar el diseño o ejecuta node server.mjs con Node 24
y abre http://localhost:8080. El frontend usa HTML, CSS y JavaScript sin
dependencias de ejecución ni compilación.

Formulario
Copia .env.example a .env y ejecuta node --env-file=.env server.mjs.
Configura CRM_BACKEND_URL con la URL base del CRM y CRM_LANDING_API_KEY
con una clave privada de al menos 32 caracteres, igual en la landing y crm-api.
El formulario usa Country.is para detectar el país por IP y sugerir el
prefijo de WhatsApp y el país de residencia. Si la detección del servidor
no identifica un país admitido, el navegador consulta Country.is con su
IP pública. El prefijo y el país se pueden ajustar. El
WhatsApp es el dato de contacto del formulario. El monto se selecciona en
MXN para México, ARS para Argentina y PYG para
Paraguay. Cada tramo muestra la referencia corta en USD al lado. Si falla
la detección, se puede seleccionar el país manualmente. Se usan las
cotizaciones de USD y PYG publicadas por el BCRA para calcular los tramos
en Argentina y Paraguay. ARS_PER_USD y PYG_PER_USD permiten fijar una
cotización por país. El tiempo admite 1, 3 o 6 meses.
La fecha de nacimiento es opcional y el consentimiento es obligatorio.

Los montos inferiores al mínimo del país no se envían al CRM. Los demás se
envían a POST /api/v1/leads/landingv8. El CRM los guarda en Retenciones
(área 1), campaña 27 y estado inicial 38, con clasificación Hueso (13k–28k),
Carne (28k–50k) o Súper carne (más de 50k) y una nota con la moneda, el tramo
y el tiempo. Aparecen en Leads Metrics según los permisos del CRM.
El CRM utiliza el índice único de landingRequestId para evitar registros duplicados
al reintentar. Durante 30 minutos, el último envío conserva su ID si se reenvía
el mismo formulario en la misma pestaña, incluso tras recargar. Solo se guarda
una huella del formulario junto al ID y su estado, no los campos del formulario.
Esto no deduplica por teléfono entre sesiones o dispositivos.

Railway
Configura el servicio con el Dockerfile de la raíz y /railway.json. Declara
CRM_BACKEND_URL y CRM_LANDING_API_KEY en las variables del servicio.
Despliega la actualización de crm-api y la de landingv8 juntas para que
el endpoint y el formulario usen los mismos campos.

Meta Pixel y API de conversiones
El píxel 1101059396141011 registra PageView al cargar. El navegador registra
CompleteRegistration una vez por solicitud aceptada y confirmada por el CRM,
incluso si se reenvía con el mismo ID. CAPI conserva el identificador landingv8-lead-<requestId> para
sus reintentos. El píxel envía CompleteRegistration sin un ID compartido con CAPI.

Define META_CAPI_ACCESS_TOKEN como secreto en el servicio de esta landing en
Railway. El servidor de la landing envía CompleteRegistration a Meta después
de recibir la confirmación del endpoint del CRM. Envía el teléfono (`ph`)
en `user_data` tras normalizarlo y aplicarle SHA-256. Conserva los datos
de atribución del navegador cuando están disponibles, pero no requiere cookies
de Meta ni una IP para enviar el evento. Los errores transitorios se reintentan
una vez y se registran sin credenciales ni datos del visitante.

Recursos
Foto del ZIP: Unsplash, photo-1758518729908-d4220a678d81.
Fuentes y licencias locales en assets/fonts y assets/licenses.
