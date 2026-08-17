# Índice de capturas para el manual

Todas las capturas están tomadas en **modo tablet** (viewport 820×1180 @2x)
contra producción (`https://cuentavoz.onrender.com`), con datos reales de
la demo — ninguna es un mockup ni tiene datos inventados. Cada imagen está
recortada a su alto real de contenido (sin recortes a mitad de pantalla).

Son 59 capturas en total (14 vistas de menú + 45 sub-pantallas, pestañas
y modales), repartidas en dos carpetas para no duplicar fotos iguales:

- **`docs/capturas/tablet/`** — las 14 pantallas de nivel de menú (una por
  cada ítem de la barra lateral, más Ingreso). Ya referenciadas también
  desde el README.
- **`docs/capturas/manual/`** (esta carpeta) — las sub-pantallas, pestañas
  secundarias y modales que no aparecen en `tablet/` porque no son la
  vista por defecto de ningún ítem del menú.

## 1) Vistas de nivel de menú — `docs/capturas/tablet/`

| Archivo | Ruta / cómo llegar | Componente |
|---|---|---|
| `ingreso.png` | Pantalla de login, sin sesión iniciada | `frontend/src/vistas/Ingreso.jsx` |
| `inicio.png` | Menú **Inicio** | `frontend/src/vistas/Inicio.jsx` |
| `pedidos.png` | Menú **Pedidos** | `frontend/src/vistas/Pedido.jsx` |
| `conteo.png` | Menú **Conteo** → selector de bodega | `frontend/src/vistas/Conteo.jsx` |
| `legalizacion.png` | Menú **Legalización** | `frontend/src/vistas/Legalizacion.jsx` |
| `bodegas.png` | Menú **Bodegas** | `frontend/src/vistas/Bodegas.jsx` |
| `auditoria.png` | Menú **Auditoría** → pestaña *Recuento ciego y cierre* (por defecto) | `frontend/src/vistas/Auditoria.jsx` |
| `reportes.png` | Menú **Reportes** → pestaña *Consolidado de la toma* (por defecto) | `frontend/src/vistas/Reportes.jsx` |
| `panel.png` | Menú **Panel** → pestaña *Resumen ejecutivo* (por defecto) | `frontend/src/vistas/Panel.jsx` |
| `ajustes.png` | Menú **Ajustes** → pestaña *Configuración* (por defecto) | `frontend/src/vistas/Ajustes.jsx` |
| `ayuda.png` | Menú **Ayuda** | `frontend/src/vistas/Ayuda.jsx` |
| `mi-perfil.png` | Menú **Mi perfil** | `frontend/src/vistas/MiPerfil.jsx` |
| `mensajes.png` | Menú **Mensajes** | `frontend/src/vistas/Mensajes.jsx` |
| `cerrar-sesion.png` | Menú **Cerrar sesión** (modal de confirmación) | `frontend/src/vistas/CerrarSesion.jsx` |

## 2) Sub-pantallas, pestañas y modales — esta carpeta

| Archivo | Ruta / cómo llegar | Componente / función |
|---|---|---|
| `auditoria-aprobaciones.png` | **Auditoría** → pestaña *Aprobaciones* | `Auditoria.jsx` → `TabAprobaciones` |
| `auditoria-pedidos-pendientes.png` | **Auditoría** → pestaña *Pedidos pendientes* | `Auditoria.jsx` → `TabPedidosPendientes` |
| `auditoria-bandeja-alertas.png` | **Auditoría** → pestaña *Bandeja de alertas* | `Auditoria.jsx` → `TabAlertas` |
| `auditoria-bodega-cerrada-detalle.png` | **Auditoría** → *Recuento ciego y cierre* → abrir una bodega que ya está **CERRADA** (KPIs de cierre, solo lectura) | `Auditoria.jsx` → rama `!sesion && estado === "cerrada"` |
| `auditoria-comparacion-doble-firma.png` | **Auditoría** → abrir una bodega *en auditoría* → *Iniciar recuento ciego* → *Ver comparación* (tabla sistema vs. conteo, con el botón **Cerrar con doble firma** visible) | `Auditoria.jsx` → `verComparar()` |
| `reportes-analisis-consumo.png` | **Reportes** → pestaña *Análisis de consumo* | `Reportes.jsx` |
| `ajustes-usuarios.png` | **Ajustes** → pestaña *Gestión de usuarios* | `Ajustes.jsx` → `TabUsuarios` |
| `ajustes-editar-usuario.png` | **Ajustes** → *Gestión de usuarios* → botón **Editar** de una persona | `Ajustes.jsx` → `TabUsuarios`, modal `editando` |
| `ajustes-asignar-bodegas.png` | **Ajustes** → *Gestión de usuarios* → botón **Asignar bodegas** | `Ajustes.jsx` → `TabUsuarios`, modal `asignando` |
| `ajustes-recetas.png` | **Ajustes** → pestaña *Recetas* | `Ajustes.jsx` → `TabRecetas` |
| `ajustes-editar-receta.png` | **Ajustes** → *Recetas* → botón **Editar** de una receta | `Ajustes.jsx` → `TabRecetas`, modal `editando` |
| `ajustes-trazabilidad.png` | **Ajustes** → pestaña *Registro de trazabilidad* | `Ajustes.jsx` → `TabTrazabilidad` |
| `bodegas-nueva.png` | **Bodegas** → botón **Bodega nueva** | `Bodegas.jsx`, `<Dialogo>` con `conCampo conVoz` |
| `bodegas-reabrir.png` | **Bodegas** → detalle de una bodega **CERRADA** → botón **Reabrir la bodega** | `Bodegas.jsx`, `<Dialogo>` `peligro` |
| `legalizacion-merma.png` | **Legalización** → servicio con merma → botón **Explicar la merma** | `Legalizacion.jsx`, `<Dialogo>` `verMerma` |
| `conteo-teclado.png` | **Conteo** → bodega abierta → botón **Teclado** ("Escribir en vez de hablar") | `Conteo.jsx`, `<Dialogo>` `mostrarTeclado` |
| `conteo-desambiguacion.png` | **Conteo** → se dicta/escribe un artículo con nombre ambiguo (ej. «hay noventa cazuelas» → CAZUELA 16 ONZ / TAPA CAZUELA 16 ONZ) | `Conteo.jsx`, tarjetas `.opciones` |
| `panel-bodegas-alertas.png` | **Panel** → pestaña *Bodegas y alertas* | `Panel.jsx` |
| `bodegas-consulta.png` | **Bodegas** → se busca un artículo por nombre (ej. «arroz») | `Bodegas.jsx`, estado `consulta` |
| `bodegas-movimientos.png` | **Bodegas** → consulta de artículo → botón **Ver movimientos** | `Bodegas.jsx`, `<Dialogo>` `movimientos` |
| `bodegas-en-recetas.png` | **Bodegas** → consulta de artículo → botón **Comparar con la receta** | `Bodegas.jsx`, `<Dialogo>` `enRecetas` |
| `pedido-porciones.png` | **Pedidos** → se elige un plato de "Platos con receta registrada" → confirmar porciones | `Pedido.jsx`, `<Dialogo>` `Porciones`/`Corregir cantidad` |
| `mi-perfil-cerrar-todos.png` | **Mi perfil** → botón **Cerrar sesión en todos los dispositivos** (recortada solo al modal — el fondo mostraba el correo personal real de la cuenta) | `MiPerfil.jsx`, `<Dialogo>` `confirmarCierre` |
| `ayuda-reportar-problema.png` | **Ayuda** → botón **Reportar un problema** | `Ayuda.jsx`, `<Dialogo>` `pedirDetalle` |
| `ayuda-escribir-admin.png` | **Ayuda** → botón **Escribirle al administrador** (solo visible para perfil auxiliar — capturada como `luis`, no como `diana`) | `Ayuda.jsx`, `<Dialogo>` `escribiendoAdmin` |
| `mensajes-responder.png` | **Mensajes** → botón **Responder** de un mensaje | `Mensajes.jsx`, `<Dialogo>` `respondiendoId` |
| `legalizacion-ajustar-voz.png` | **Legalización** → botón **Ajustar por voz** | `Legalizacion.jsx`, `<Dialogo>` `pedirAjuste` |
| `auditoria-alerta-detalle.png` | **Auditoría** → *Bandeja de alertas* → botón **Ver** de una alerta | `Auditoria.jsx`, `<Dialogo>` `verDetalle` (dentro de `TabAlertas`) |
| `auditoria-teclado.png` | **Auditoría** → recuento ciego activo → botón **Teclado** | `Auditoria.jsx`, `<Dialogo>` `mostrarDictado` |
| `conteo-crear-producto.png` | **Conteo** → se dicta un artículo que no existe en el catálogo (ej. «hay noventa alicornios voladores») | `Conteo.jsx` → `FormularioCrearProducto` |
| `conteo-bodega-no-encontrada.png` | **Conteo** → se busca una bodega por nombre exacto que no existe en el catálogo | `Conteo.jsx`, estado `bodegaNoEncontrada` |
| `conteo-bodega-desambiguacion.png` | **Conteo** → se busca una bodega por un nombre ambiguo (ej. «kiosco» → 6 bodegas parecidas) | `Conteo.jsx`, estado `opcionesBodega` |
| `conteo-sin-conexion.png` | **Conteo** → bodega abierta → se pierde la conexión de red (formulario manual + cola de sincronización) | `Conteo.jsx` → `FormularioOffline` |
| `pedido-receta.png` | **Pedidos** → se elige un plato → botón **Ver la receta** (catálogo de Colsubsidio + preparación paso a paso) | `Pedido.jsx`, estado `receta` |
| `pedido-calculado.png` | **Pedidos** → botón **Calcular el pedido** (KPIs + tabla de insumos necesario/hay/falta, con el aviso de "Revise antes de enviar") | `Pedido.jsx`, estado `lineas`/`avisos` |
| `pedido-recibo.png` | **Pedidos** → botón **Enviar pedido al almacén** (recibo con número real `PED-20260817-064325`) | `Pedido.jsx`, estado `recibo` |
| `conteo-alerta-unidad.png` | **Conteo** → se dicta una cantidad en una unidad distinta a la del artículo (ej. litros para algo que se maneja en kilos) | `Conteo.jsx`, banner genérico (`alerta === "unidad"`, también cubre `"negativo"` e inexistente) |
| `bodegas-sugerencia-nombre.png` | **Bodegas** → se busca en el buscador de artículos el nombre de una bodega en vez de un ingrediente | `Bodegas.jsx`, banner `consulta.sugerencia_bodega` |
| `pedido-sin-conexion.png` | **Pedidos** → se pierde la conexión de red (no se puede calcular sin stock en vivo) | `Pedido.jsx`, banner `offline` |
| `reportes-vista-estado-tablero.png` | **Reportes** → clic en la tarjeta *Estado del tablero* (columnas: bodega, estado) | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |
| `reportes-vista-detalle-bodega.png` | **Reportes** → clic en la tarjeta *Detalle de bodega* (columnas: artículo, unidad, bodega, contado, SD, diferencia) | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |
| `reportes-vista-analisis-archivo.png` | **Reportes** → clic en la tarjeta *Análisis de consumo* (columnas: nombre, sobra, veces, % sobrepedido) | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |
| `reportes-vista-trazabilidad.png` | **Reportes** → clic en la tarjeta *Registro de trazabilidad* (columnas: fecha, persona, acción, detalle — 390 filas reales) | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |
| `reportes-vista-diferencias.png` | **Reportes** → clic en la tarjeta *Diferencias por bodega* | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |
| `reportes-vista-consolidado.png` | **Reportes** → clic en la tarjeta *Consolidado para My Inventory* | `Reportes.jsx`, `TabConsolidado` → `previsualizar()` |

**No incluidas, y por qué:**
- **Banner "solo para administradores" en Auditoría** (`Auditoria.jsx`,
  `!esAuditor`) — el ítem de menú está oculto para perfil auxiliar
  (`MENU` lo filtra client-side), así que no hay ruta de navegación normal
  para llegar a verlo.
- **Desambiguación de producto en Pedidos** — el mismo patrón visual que
  `conteo-desambiguacion.png`, pero `Pedido.jsx` no tiene un modo "escribir
  en vez de hablar" para el nombre del insumo (solo para porciones), así
  que no hay forma de provocarla sin reconocimiento de voz real.

## Pendiente: alerta de cantidad fuera de lo esperado

La tercera captura "de voz" —la alerta *«el sistema espera alrededor de
X, ¿confirma Y?»*— **no se incluye** en este lote. El backend solo la
dispara si el artículo dictado tiene un `StockSistema` real para esa
bodega (`backend/servicios/validacion.py:44-52`), y las únicas 8 bodegas
con stock real ya están en estados curados para la demo (cerradas, en
conteo o en auditoría) que no se debían alterar — de hecho, al intentar
abrir una de ellas para probarlo, el propio backend lo bloqueó con
*"Esa bodega ya está en conteo por otra persona"*, confirmando que ese
candado de sesión funciona como debe.

Para conseguir esta captura sin tocar la demo real haría falta un
endpoint temporal para sembrar una fila de stock (dos despliegues extra
solo para una imagen) — se dejó pendiente en vez de hacerlo. El
comportamiento se puede documentar en el manual citando directamente
`validacion.py:46-52`.
