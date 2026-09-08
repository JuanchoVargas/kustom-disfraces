import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle } from 'docx'
import fs from 'fs'; import path from 'path'; import sharp from 'sharp'

// Sin argumentos: versión celular (docs/guia/capturas/movil → Kustom_Guia_Panel_Inventario.docx).
// Con --escritorio: capturas de escritorio, imágenes más anchas y archivo aparte (no pisa el de celular).
const ESCRITORIO = process.argv.includes('--escritorio')
const CAPTURAS = ESCRITORIO ? 'docs/guia/capturas/escritorio' : 'docs/guia/capturas/movil'
const SALIDA   = ESCRITORIO ? 'Kustom_Guia_Panel_Inventario_Escritorio.docx' : 'Kustom_Guia_Panel_Inventario.docx'
const ANCHO_IMG = ESCRITORIO ? 470 : 265     // puntos en la página
const ANCHO_PX  = ESCRITORIO ? 1100 : 400    // reducción del PNG antes de incrustar
const M='7C3AED', G='444444', C='FAF6EF', N='B45309'

const buf = {}
for (const f of fs.readdirSync(CAPTURAS).filter(f=>/^\d\d-/.test(f))) {
  const img = sharp(path.join(CAPTURAS,f)).resize({width:ANCHO_PX}).jpeg({quality:ESCRITORIO?74:68})
  const meta = await sharp(path.join(CAPTURAS,f)).metadata()
  buf[f.slice(0,2)] = { data: await img.toBuffer(), ratio: meta.height/meta.width }
}
const P=(t,o={})=>new Paragraph({spacing:{after:o.after??110,before:o.before??0},
  children:[new TextRun({text:t,size:o.size??22,bold:o.bold,italics:o.italics,color:o.color??G})]})
const H1=t=>new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:300,after:130},
  children:[new TextRun({text:t,size:28,bold:true,color:M})]})
const H2=t=>new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:200,after:100},
  children:[new TextRun({text:t,size:24,bold:true,color:'222222'})]})
const S=(n,t)=>new Paragraph({spacing:{after:85},indent:{left:200},children:[
  new TextRun({text:n+'. ',size:22,bold:true,color:M}),new TextRun({text:t,size:22,color:G})]})
const B=t=>new Paragraph({numbering:{reference:'v',level:0},spacing:{after:65},
  children:[new TextRun({text:t,size:22,color:G})]})
const NOTA=(ti,tx,col=M)=>new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],
  rows:[new TableRow({children:[new TableCell({width:{size:9360,type:WidthType.DXA},
  shading:{type:ShadingType.CLEAR,fill:C},margins:{top:140,bottom:140,left:190,right:190},
  borders:{left:{style:BorderStyle.SINGLE,size:18,color:col},top:{style:BorderStyle.NONE,size:0,color:'FFFFFF'},
  bottom:{style:BorderStyle.NONE,size:0,color:'FFFFFF'},right:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}},
  children:[new Paragraph({spacing:{after:55},children:[new TextRun({text:ti,size:22,bold:true,color:col})]}),
  new Paragraph({children:[new TextRun({text:tx,size:21,color:G})]})]})]})]})
const IMG=(k,cap,w=ANCHO_IMG)=>{const b=buf[k]; if(!b) return ESCRITORIO && ['17','18'].includes(k) ? [] : [P('[falta captura '+k+']')]
  return [new Paragraph({spacing:{before:110,after:50},alignment:AlignmentType.CENTER,
    children:[new ImageRun({type:'jpg',data:b.data,transformation:{width:w,height:Math.round(w*b.ratio)}})]}),
    new Paragraph({spacing:{after:170},alignment:AlignmentType.CENTER,
      children:[new TextRun({text:cap,size:17,italics:true,color:'888888'})]})]}
const FILA=(c,o)=>new TableRow({children:c.map((x,i)=>new TableCell({
  width:{size:o.w[i],type:WidthType.DXA},shading:{type:ShadingType.CLEAR,fill:o.h?M:'FFFFFF'},
  margins:{top:85,bottom:85,left:125,right:125},
  children:[new Paragraph({children:[new TextRun({text:x,size:20,bold:o.h,color:o.h?'FFFFFF':G})]})]}))})

const doc = new Document({
 numbering:{config:[{reference:'v',levels:[{level:0,format:'bullet',text:'•',
   alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:440,hanging:230}}}}]}]},
 sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:950,bottom:950,left:1080,right:1080}}},
 children:[
  new Paragraph({spacing:{after:40},children:[new TextRun({text:'KUSTOM DISFRACES',size:20,bold:true,color:M})]}),
  new Paragraph({spacing:{after:60},children:[new TextRun({text:'Guía del panel de Inventario',size:40,bold:true,color:'111111'})]}),
  P('Precios, existencias y fotos · Manual paso a paso · Septiembre de 2026',{size:21,italics:true}),
  new Paragraph({spacing:{after:200},border:{bottom:{style:BorderStyle.SINGLE,size:8,color:'DDDDDD'}},children:[]}),
  P('Este panel reemplaza el trabajo de entrar producto por producto en WordPress. Desde aquí se cambian precios, se controlan existencias y se suben fotos, con buscador, filtros y cambios masivos. Funciona igual en computador y en celular.',{after:160}),
  NOTA('Lo primero que hay que entender: el modo simulación','Mientras arriba aparezca la etiqueta amarilla SIMULACIÓN, nada de lo que hagas afecta la tienda ni la página web. Los cambios se guardan aquí, en una lista de pendientes, para aplicarlos todos juntos cuando se active la escritura. Es el modo seguro para aprender y para cargar datos sin miedo a dañar nada.'),

  H1('1. Entrar al panel'),
  S(1,'Abre esta dirección: www.disfraceskustom.com/admin/inventario'),
  S(2,'Escribe la contraseña y toca "Entrar".'),
  S(3,'La sesión queda guardada 7 días; después vuelve a pedirla.'),
  ...IMG('01','Pantalla de acceso al panel.'),
  NOTA('Guárdalo en la pantalla de inicio del celular','Abre la dirección en Chrome, toca el menú (⋮) y elige "Agregar a pantalla de inicio". Queda como una app y entras con un toque.'),

  H1('2. Conocer la pantalla'),
  P('Arriba tienes cuatro botones y, debajo, el buscador y los filtros.',{after:100}),
  B('Sincronizar: trae los datos más recientes desde la tienda. Úsalo si alguien cambió algo en WordPress.'),
  B('Probar Woo: comprueba la conexión con la tienda. Es de diagnóstico, no lo necesitas a diario.'),
  B('Bandeja: te lleva a los mensajes de los clientes.'),
  B('Salir: cierra la sesión.'),
  P('Debajo aparece el aviso amarillo del modo simulación, que además te dice cuántas tallas tienen cambios pendientes de aplicar.',{after:100}),
  ...IMG('02','Pantalla principal: botones, buscador, filtros y la lista de productos.'),

  H1('3. Buscar un disfraz'),
  S(1,'Escribe en el buscador el nombre o el código del disfraz.'),
  S(2,'La lista se filtra sola mientras escribes.'),
  S(3,'Para volver a ver todo, toca la × del buscador o el botón "Limpiar".'),
  ...IMG('03','Buscando "spider": la lista muestra solo los 21 productos que coinciden.'),

  H1('4. Filtrar por categoría'),
  P('Los cuatro desplegables permiten acotar la lista sin escribir nada:',{after:100}),
  B('Estados: publicados o borradores.'),
  B('Líneas: Súper Acolchado, Línea Eco, Vestidos, Trusas, etc.'),
  B('Públicos: Bebés, Niños, Niñas, Damas, Caballeros, Combos.'),
  B('Stock: todo, con stock bajo o agotados.'),
  P('Se pueden combinar. En el ejemplo: público Niñas + línea Vestidos = 5 productos.',{after:100}),
  ...IMG('04','Filtros combinados: Niñas + Vestidos.'),

  H1('5. Ver las tallas de un producto'),
  S(1,'Toca la flecha › a la derecha del producto (o el producto mismo).'),
  S(2,'Se despliegan todas sus tallas, cada una con su código, precio normal, precio rebajado, stock y estado.'),
  S(3,'Toca de nuevo para cerrarlo.'),
  ...IMG('05','Producto desplegado: una ficha por talla.'),
  P('"Sin gestionar" en la columna de stock significa que ese disfraz todavía no lleva control de existencias: se puede vender siempre, sin descontar inventario.',{after:150,italics:true}),

  H1('6. Cambiar el precio de una talla'),
  S(1,'Despliega el producto y ubica la talla.'),
  S(2,'Toca el campo "Precio normal" y escribe el valor nuevo. Solo números, sin puntos ni signo de pesos.'),
  S(3,'Aparecen dos botones: "Guardar" y "Deshacer".'),
  S(4,'Toca "Guardar". La talla se ilumina en verde un instante: eso confirma que quedó guardado.'),
  ...IMG('06','Precio en edición, con los botones Guardar y Deshacer.'),
  ...IMG('07','El destello verde confirma que el cambio se guardó.'),
  NOTA('Cómo escribir los precios','Solo números. Correcto: 125900. Incorrecto: $125.900 · 125,900 · 125.900'),
  P('El campo "Precio rebajado" es opcional: si lo llenas, ese será el precio de oferta y el normal aparecerá tachado en la web. Para quitar la oferta, borra el contenido de ese campo.',{after:150}),

  H1('7. Cambiar precios de varios productos a la vez'),
  P('Es la función que más tiempo ahorra: en lugar de talla por talla, se cambian decenas de una sola vez.',{after:110}),
  H2('Paso 1 · Seleccionar'),
  S(1,'Filtra o busca para dejar en pantalla los productos que quieres cambiar.'),
  S(2,'Marca la casilla de cada uno, o usa "Seleccionar página" para marcarlos todos.'),
  S(3,'El botón morado "Operación masiva" muestra cuántos llevas seleccionados.'),
  ...IMG('08','Tres productos seleccionados. El botón indica el total.'),
  H2('Paso 2 · Revisar antes de aplicar'),
  P('Al tocar "Operación masiva" se abre una ventana que muestra exactamente qué va a cambiar: el precio actual tachado y el nuevo al lado. Nada se aplica hasta que lo confirmes.',{after:100}),
  ...IMG('09','Vista previa: 12 cambios, con el antes y el después de cada talla.'),
  H2('Paso 3 · Aplicar'),
  S(1,'Revisa la lista con calma. Puedes marcar "Ver solo cambios y errores" para no perderte.'),
  S(2,'Toca el botón morado "Aplicar N cambios".'),
  S(3,'Aparece el mensaje verde de confirmación.'),
  ...IMG('10','Confirmación: 12 cambios aplicados.'),
  NOTA('Revisa siempre la vista previa','Es la última oportunidad de detectar un error antes de que se aplique a decenas de tallas. Si algo no cuadra, toca "Volver" y ajusta la selección.',N),

  H1('8. Exportar a Excel'),
  P('Sirve para trabajar cómodo desde el computador, para pasarle la lista a alguien, o para guardar una copia antes de un cambio grande.',{after:100}),
  S(1,'Filtra lo que quieras exportar (o no filtres nada para exportar todo).'),
  S(2,'Toca "Exportar Excel" (o "CSV" si prefieres ese formato).'),
  S(3,'El archivo se descarga con una fila por talla: código, nombre, talla, precio, oferta y stock.'),
  ...IMG('11','Botones de exportación. El archivo descargado sirve también para importar.'),
  NOTA('El archivo exportado es la plantilla de importación','No hace falta armar un Excel desde cero: exporta, edita las columnas de precio o stock, y vuelve a subirlo.'),

  H1('9. Importar desde Excel'),
  S(1,'Toca "Importar" y elige el archivo .xlsx o .csv.'),
  S(2,'El sistema revisa fila por fila y muestra un resumen: cuántas cambian, cuántas quedan igual y cuántas tienen error.'),
  S(3,'Las filas con error aparecen en rojo y no se aplican: código que no existe, precio inválido, oferta mayor que el precio o stock negativo.'),
  S(4,'Si todo está bien, toca "Aplicar N cambios".'),
  ...IMG('12','Previsualización: en verde lo que se actualiza, en rojo lo que tiene error.'),
  NOTA('Una celda vacía significa "no tocar"','Si dejas en blanco la columna de stock de una talla, esa talla se queda como está. No se interpreta como cero.'),

  H1('10. Subir fotos de un producto'),
  S(1,'Despliega el producto y baja hasta la sección "Imágenes".'),
  S(2,'Toca "Subir o arrastrar" y elige las fotos (máximo 10 MB cada una).'),
  S(3,'Se convierten solas a un formato liviano, sin perder calidad.'),
  S(4,'La primera queda marcada como PRINCIPAL: es la que se ve en el catálogo. Puedes cambiar cuál es la principal.'),
  ...IMG('13','Sección de imágenes: la principal marcada y el botón para subir más.'),
  NOTA('Las fotos aún no cambian en la página web','Se guardan correctamente en WordPress, pero la web sigue mostrando las fotos actuales hasta que se active el cambio de origen. Está previsto para después de la temporada, para no arriesgar la velocidad del sitio en el mes de mayor venta.',N),

  H1('11. Existencias y disfraces agotados'),
  P('Cuando el control de inventario esté activo, cada talla mostrará su cantidad y un color:',{after:100}),
  new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[2400,6960],rows:[
    FILA(['Color','Significado'],{w:[2400,6960],h:true}),
    FILA(['Verde','Existencias normales.'],{w:[2400,6960]}),
    FILA(['Ámbar','Stock bajo: quedan 5 unidades o menos.'],{w:[2400,6960]}),
    FILA(['Rojo / tachado','Agotado. La talla aparece tachada y no se puede comprar en la web.'],{w:[2400,6960]})]}),
  P('',{after:110}),
  ...IMG('14','Tallas tachadas: ese producto está agotado y sale del catálogo.'),
  P('Además llega un correo a ventas@disfraceskustom.com cuando una talla baja del mínimo, y un resumen diario a las 8:00 a.m. con todo lo agotado o por agotarse.',{after:150}),

  H1('12. Dos formas de ver la lista'),
  P('El conmutador "Cómodo / Compacto" cambia cuánta información se ve de cada producto. Cómodo muestra foto grande, línea y público; Compacto muestra más productos en pantalla. Tu elección queda guardada.',{after:100}),
  ...IMG('16','Modo Compacto: más productos visibles a la vez.'),
  ...IMG('17','Modo Cómodo: cada producto con su foto y sus etiquetas.'),
  ...IMG('18','Producto desplegado en el celular: una ficha por talla.'),

  H1('13. Cuando no aparece nada'),
  P('Si el buscador o los filtros no encuentran resultados, aparece KO con una caja vacía y el botón "Quitar filtros" para volver a ver todo. No es un error: solo significa que ningún producto coincide.',{after:100}),
  ...IMG('15','Estado vacío: ningún producto coincide con la búsqueda.'),

  H1('14. Preguntas frecuentes'),
  H2('Cambié un precio y no lo veo en la página web'),
  P('Es lo esperado mientras esté activo el modo simulación: los cambios quedan guardados aquí y se aplican todos juntos cuando se active la escritura. Juan Diego avisará cuando eso ocurra.',{after:110}),
  H2('¿Puedo dañar algo?'),
  P('En modo simulación, no. Nada de lo que hagas llega a la tienda ni a la web. Es el momento de practicar y de cargar información con tranquilidad.',{after:110}),
  H2('Me equivoqué en un precio'),
  P('Si aún no guardaste, toca "Deshacer". Si ya guardaste, escribe el valor correcto y guarda de nuevo. Todos los cambios quedan registrados con fecha en "Últimos cambios".',{after:110}),
  H2('¿Qué significa "sin gestionar"?'),
  P('Que esa talla todavía no lleva control de existencias: se puede vender siempre. Cuando se cargue el inventario, pasará a mostrar una cantidad.',{after:110}),
  H2('¿Por qué algunos productos dicen "borrador"?'),
  P('Son productos creados pero sin publicar: no aparecen en la tienda. Hay que decidir si se completan y publican o si se eliminan.',{after:110}),
  H2('El panel me pide la contraseña otra vez'),
  P('Pasaron 7 días desde el último ingreso. Vuelve a escribirla.',{after:110}),
  H2('¿Puedo usarlo desde el celular?'),
  P('Sí. La pantalla se adapta y los productos se ven como tarjetas. De hecho está pensado para usarse así.',{after:170}),

  new Paragraph({spacing:{before:220},border:{top:{style:BorderStyle.SINGLE,size:8,color:'DDDDDD'}},children:[]}),
  P('Soporte: Juan Diego Vargas — Nemedi Networks.',{size:20,italics:true,after:40}),
  P('Kustom Disfraces · Comercializadora Induscol · Bogotá, Colombia',{size:19,color:'888888'})
 ]}]})

fs.writeFileSync(SALIDA, await Packer.toBuffer(doc))
console.log('Listo:', SALIDA)
