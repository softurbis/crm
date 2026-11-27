// ============================================================
// URBIS CONTROL — APP DE ESCRITORIO (Windows)
// ------------------------------------------------------------
// No es otro sistema: es una ventana propia que abre EL MISMO panel
// (panel.urbisgroupinmobiliaria.com) con el motor WebView2 de Edge, que ya viene
// en Windows 10/11. Mismos datos, mismos permisos; lo que se publica en el panel
// aparece aquí solo, sin reinstalar. La web en el navegador sigue de respaldo.
//
// Qué hace además del navegador:
//  · Se instala sola la primera vez (pregunta antes): copia en
//    %LOCALAPPDATA%\Programs\Urbis Control, acceso directo en el Escritorio y en
//    Inicio, y aparece en "Aplicaciones instaladas" para desinstalarla.
//  · Un solo archivo: las librerías de WebView2 van adentro del .exe.
//  · Recuerda el tamaño y la posición de la ventana.
//  · Los enlaces a otros sitios (WhatsApp, Google, etc.) se abren en el navegador.
//  · Clic derecho > "Abrir esta página en el navegador": el respaldo a un clic.
//  · Sin internet muestra una pantalla en español con "Reintentar" y "Abrir en el
//    navegador", en vez del error en inglés.
//  · Guarda la contraseña si la persona quiere (como Chrome).
//
// Se compila con compilar.ps1 (usa el compilador de C# que trae Windows; C# 5:
// nada de $"", ?. ni nameof).
//
// Argumentos: --sin-instalar (no ofrece instalar) · --instalar (instala sin
// preguntar) · --desinstalar [--silencioso] · --url=<página del panel>
// ============================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Urbis Control")]
[assembly: AssemblyDescription("Urbis Control")]
[assembly: AssemblyProduct("Urbis Control")]
[assembly: AssemblyCompany("Urbis Group")]
[assembly: AssemblyCopyright("Urbis Group")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace UrbisEscritorio
{
    static class Programa
    {
        // al cambiar la versión, cambiar también AssemblyFileVersion (arriba): con ella
        // el .exe nuevo sabe que tiene que actualizar al instalado
        public const string VERSION = "1.2.0";
        public const string NOMBRE = "Urbis Control";
        public const string HOST = "panel.urbisgroupinmobiliaria.com";
        public const string PANEL = "https://" + HOST + "/";

        public static string CarpetaDatos { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UrbisControl"); } }
        public static string CarpetaInstalacion { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", NOMBRE); } }
        public static string ExeInstalado { get { return Path.Combine(CarpetaInstalacion, "UrbisControl.exe"); } }

        static readonly Dictionary<string, Assembly> cargadas = new Dictionary<string, Assembly>(StringComparer.OrdinalIgnoreCase);

        [STAThread]
        static int Main(string[] args)
        {
            // las librerías de WebView2 viajan DENTRO del .exe: se cargan desde ahí
            AppDomain.CurrentDomain.AssemblyResolve += Resolver;
            try { System.Net.ServicePointManager.SecurityProtocol |= System.Net.SecurityProtocolType.Tls12; } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { return Arrancar(args); }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo abrir Urbis Control:\n\n" + ex.Message + "\n\nMientras tanto, usa el panel en el navegador: " + PANEL,
                    NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        static byte[] Recurso(string nombre)
        {
            using (Stream st = Assembly.GetExecutingAssembly().GetManifestResourceStream(nombre))
            {
                if (st == null) return null;
                using (MemoryStream ms = new MemoryStream()) { st.CopyTo(ms); return ms.ToArray(); }
            }
        }

        static Assembly Resolver(object quien, ResolveEventArgs e)
        {
            string nombre = new AssemblyName(e.Name).Name;
            lock (cargadas)
            {
                Assembly a;
                if (cargadas.TryGetValue(nombre, out a)) return a;
                byte[] b = Recurso(nombre + ".dll");
                if (b == null) return null;
                a = Assembly.Load(b);
                cargadas[nombre] = a;
                return a;
            }
        }

        // aparte de Main para que las librerías de WebView2 se pidan DESPUÉS de
        // conectar el Resolver
        [MethodImpl(MethodImplOptions.NoInlining)]
        static int Arrancar(string[] args)
        {
            bool sinInstalar = false, instalar = false, desinstalar = false, silencioso = false, minimizada = false, actualizar = false;
            string url = PANEL;
            foreach (string a in args)
            {
                string x = (a ?? "").Trim();
                if (Igual(x, "--minimizada")) minimizada = true;          // así arranca al prender la PC
                else if (Igual(x, "--actualizar")) actualizar = true;      // la descargó la versión vieja
                else if (Igual(x, "--sin-instalar")) sinInstalar = true;
                else if (Igual(x, "--instalar")) instalar = true;
                else if (Igual(x, "--desinstalar")) desinstalar = true;
                else if (Igual(x, "--silencioso")) silencioso = true;
                else if (x.StartsWith("--url=", StringComparison.OrdinalIgnoreCase) && EsDelPanel(x.Substring(6))) url = x.Substring(6);
            }
            if (desinstalar) return Instalador.Desinstalar(silencioso);
            if (actualizar)
            {
                // la versión vieja se está cerrando: se espera (hasta 15 s) a que suelte la copia
                // única y se instala sin preguntar; después se abre la instalada
                for (int i = 0; i < 60; i++)
                {
                    bool libre = false;
                    using (System.Threading.Mutex m = new System.Threading.Mutex(false, @"Local\UrbisControl.Instancia"))
                    {
                        try { libre = m.WaitOne(0); if (libre) m.ReleaseMutex(); }
                        catch (System.Threading.AbandonedMutexException) { libre = true; }
                    }
                    if (libre) break;
                    System.Threading.Thread.Sleep(250);
                }
                instalar = true;
            }
            if (!sinInstalar && !Instalador.CorriendoInstalado() && Instalador.Ofrecer(instalar)) return 0;

            // el cargador nativo de WebView2 también va adentro: se deja en disco una vez
            byte[] cargador = Recurso("WebView2Loader.dll");
            string huella;
            using (SHA1 sha = SHA1.Create()) huella = BitConverter.ToString(sha.ComputeHash(cargador)).Replace("-", "").Substring(0, 12);
            string bin = Path.Combine(CarpetaDatos, "bin", huella);
            string dll = Path.Combine(bin, "WebView2Loader.dll");
            if (!File.Exists(dll) || new FileInfo(dll).Length != cargador.Length)
            {
                Directory.CreateDirectory(bin);
                File.WriteAllBytes(dll, cargador);
            }
            CoreWebView2Environment.SetLoaderDllFolderPath(bin);

            string motor = null;
            try { motor = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
            if (string.IsNullOrEmpty(motor))
            {
                if (MessageBox.Show("A esta computadora le falta \"Microsoft Edge WebView2\", el componente con el que se dibuja el panel.\n\n¿Abrir la página de Microsoft para instalarlo (es gratis)?\n\nMientras tanto, el panel funciona igual en el navegador.",
                    NOMBRE, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    AbrirAfuera("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                return 2;
            }
            // UNA SOLA COPIA ABIERTA (v1.2): si ya está abierta (o minimizada junto al reloj),
            // abrirla otra vez solo trae esa al frente. Así no hay dos íconos ni avisos repetidos.
            bool primera;
            instancia = new System.Threading.Mutex(true, @"Local\UrbisControl.Instancia", out primera);
            if (!primera)
            {
                if (!minimizada) try { System.Threading.EventWaitHandle.OpenExisting(@"Local\UrbisControl.Mostrar").Set(); } catch { }
                return 0;
            }
            System.Threading.EventWaitHandle pedirMostrar = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, @"Local\UrbisControl.Mostrar");

            Ventana ventana = new Ventana(url);
            System.Threading.Thread escucha = new System.Threading.Thread(() =>
            {
                while (true)
                {
                    pedirMostrar.WaitOne();
                    try { ventana.BeginInvoke(new Action(ventana.TraerAlFrente)); } catch { }
                }
            });
            escucha.IsBackground = true;
            escucha.Start();

            if (minimizada)
            {
                // al prender la PC: sin bienvenida, directo minimizada (los avisos funcionan igual)
                ApplicationContext ctx = new ApplicationContext();
                EventHandler alEmpezar = null;
                alEmpezar = (s, e) => { Application.Idle -= alEmpezar; ventana.Preparar(null, ctx, true); };
                Application.Idle += alEmpezar;
                Application.Run(ctx);
                return 0;
            }
            // primero la pantalla de bienvenida; el panel carga escondido detrás y
            // aparece cuando está listo (y pasaron al menos unos segundos)
            Bienvenida bienvenida = new Bienvenida();
            ApplicationContext contexto = new ApplicationContext(bienvenida);
            bienvenida.Shown += (s, e) => ventana.Preparar(bienvenida, contexto, false);
            Application.Run(contexto);
            return 0;
        }
        static System.Threading.Mutex instancia;   // vive mientras viva la app

        static bool Igual(string a, string b) { return string.Equals(a, b, StringComparison.OrdinalIgnoreCase); }

        public static bool EsDelPanel(string u)
        {
            Uri x;
            return Uri.TryCreate(u, UriKind.Absolute, out x) && x.Scheme == Uri.UriSchemeHttps && Igual(x.Host, HOST);
        }

        // abre en el navegador / WhatsApp / correo. Solo esquemas conocidos: una página
        // no puede pedirle a la app que ejecute archivos de la PC
        public static void AbrirAfuera(string u)
        {
            Uri x;
            if (!Uri.TryCreate(u, UriKind.Absolute, out x)) return;
            string s = x.Scheme.ToLowerInvariant();
            if (s != "https" && s != "http" && s != "mailto" && s != "tel" && s != "whatsapp") return;
            try { Process.Start(new ProcessStartInfo(x.AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show("No se pudo abrir " + x.AbsoluteUri + "\n\n" + ex.Message, NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }

    // ------------------------------------------------------------ LA VENTANA
    class Ventana : Form
    {
        readonly WebView2 web;
        readonly string inicio;
        readonly HashSet<ulong> canceladas = new HashSet<ulong>();   // navegaciones que mandamos al navegador

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int atributo, ref int valor, int tam);

        // barra de título oscura, del color del panel (Windows 11; en Windows 10 queda la normal)
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int si = 1, fondo = 0x0012150D, letras = 0x00EAF3EE;     // COLORREF = 0x00BBGGRR
            try
            {
                DwmSetWindowAttribute(Handle, 20, ref si, 4);       // modo oscuro
                DwmSetWindowAttribute(Handle, 35, ref fondo, 4);    // color de la barra = --bg
                DwmSetWindowAttribute(Handle, 36, ref letras, 4);   // color del título = --text
            }
            catch { }
        }

        public Ventana(string url)
        {
            inicio = url;
            Text = Programa.NOMBRE;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            BackColor = Color.FromArgb(0x0D, 0x15, 0x12);       // --bg del panel: sin destello blanco al abrir
            MinimumSize = new Size(800, 560);
            StartPosition = FormStartPosition.Manual;
            RestaurarPosicion();

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            Controls.Add(web);

            CrearBandeja();
            FormClosing += (s, e) => GuardarPosicion();
            FormClosed += (s, e) => { bandeja.Visible = false; bandeja.Dispose(); };   // sin ícono fantasma junto al reloj
            // la que arrancó minimizada (al prender la PC) vuelve maximizada si así se usaba
            Resize += (s, e) => { if (maximizarAlVolver && WindowState == FormWindowState.Normal) { maximizarAlVolver = false; WindowState = FormWindowState.Maximized; } };
        }

        // ------------------------------------------------ el ícono junto al reloj y los avisos (v1.2)
        NotifyIcon bandeja;
        ToolStripMenuItem itemAlPrender;
        Dictionary<string, object> avisoIr;          // a dónde lleva el último aviso al hacerle clic
        bool maximizarAlVolver;
        readonly System.Web.Script.Serialization.JavaScriptSerializer json = new System.Web.Script.Serialization.JavaScriptSerializer();

        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

        void CrearBandeja()
        {
            bandeja = new NotifyIcon { Icon = Icon, Text = Programa.NOMBRE, Visible = true };
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Urbis Control", null, (s, e) => TraerAlFrente());
            itemAlPrender = new ToolStripMenuItem("Abrir al prender la PC") { Checked = AlPrender.Activo };
            itemAlPrender.Click += (s, e) => CambiarAlPrender();
            menu.Items.Add(itemAlPrender);
            itemActualizar = new ToolStripMenuItem("Actualizar") { Visible = false };
            itemActualizar.Click += (s, e) => Actualizar();
            menu.Items.Add(itemActualizar);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Salir", null, (s, e) => Close());
            bandeja.ContextMenuStrip = menu;
            bandeja.DoubleClick += (s, e) => TraerAlFrente();
            bandeja.BalloonTipClicked += (s, e) => { if (avisoEsVersion) { avisoEsVersion = false; Actualizar(); } else { TraerAlFrente(); IrAlAviso(); } };
        }

        // ------------------------------------------------ versión nueva (v1.2)
        // Al abrir, se mira https://panel…/app/version.json (lo arma escritorio/compilar.ps1). Si hay
        // una más nueva: aviso de Windows + "Actualizar" en el ícono del reloj. Al aceptar se baja
        // el .exe nuevo, se abre con --actualizar y esta se cierra: la nueva se instala sola.
        ToolStripMenuItem itemActualizar;
        bool avisoEsVersion;
        string versionNueva, urlNueva;

        async void BuscarVersionNueva()
        {
            try
            {
                await Task.Delay(8000);                        // que el panel cargue primero
                string txt;
                using (System.Net.WebClient wc = new System.Net.WebClient())
                {
                    wc.Encoding = System.Text.Encoding.UTF8;
                    txt = await wc.DownloadStringTaskAsync(new Uri(Programa.PANEL + "app/version.json?v=" + DateTime.Now.Ticks));
                }
                Dictionary<string, object> m = json.Deserialize<Dictionary<string, object>>(txt);
                Version nueva;
                if (!Version.TryParse(Texto(m, "version"), out nueva) || nueva <= new Version(Programa.VERSION)) return;
                Uri u;
                if (!Uri.TryCreate(new Uri(Programa.PANEL), Texto(m, "url"), out u) || !Programa.EsDelPanel(u.AbsoluteUri)) return;   // solo del panel
                versionNueva = Texto(m, "version"); urlNueva = u.AbsoluteUri;
                itemActualizar.Text = "⬆ Actualizar a la versión " + versionNueva;
                itemActualizar.Visible = true;
                avisoEsVersion = true;
                bandeja.ShowBalloonTip(15000, "Hay una versión nueva de Urbis Control", "Versión " + versionNueva + ". Haz clic aquí para actualizar: tarda unos segundos.", ToolTipIcon.Info);
            }
            catch { }                                          // sin internet: será la próxima vez
        }

        async void Actualizar()
        {
            if (string.IsNullOrEmpty(urlNueva)) return;
            TraerAlFrente();
            if (MessageBox.Show("Se va a bajar la versión " + versionNueva + " de Urbis Control. La app se cierra un momento y se vuelve a abrir sola, ya actualizada.\n\nSi estás escribiendo algo, guárdalo antes.\n\n¿Actualizar ahora?",
                Programa.NOMBRE, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            string destino = Path.Combine(Path.GetTempPath(), "UrbisControl-" + versionNueva + ".exe");
            try
            {
                using (System.Net.WebClient wc = new System.Net.WebClient()) await wc.DownloadFileTaskAsync(new Uri(urlNueva), destino);
                string bajada = FileVersionInfo.GetVersionInfo(destino).FileVersion ?? "";
                if (!bajada.StartsWith(versionNueva)) throw new Exception("el archivo bajado no es la versión " + versionNueva);
            }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo bajar la versión nueva:\n\n" + ex.Message + "\n\nPuedes bajarla desde el panel: " + urlNueva, Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Process.Start(new ProcessStartInfo(destino, "--actualizar") { UseShellExecute = true });
            Application.Exit();
        }

        void CambiarAlPrender()
        {
            try { AlPrender.Poner(!AlPrender.Activo); }
            catch (Exception ex) { MessageBox.Show("No se pudo cambiar: " + ex.Message, Programa.NOMBRE); }
            itemAlPrender.Checked = AlPrender.Activo;
            if (AlPrender.Activo) bandeja.ShowBalloonTip(5000, Programa.NOMBRE, "Listo: Urbis Control se abrirá solo (minimizado) cada vez que prendas la PC.", ToolTipIcon.None);
        }

        // la trae al frente: desde el ícono del reloj, desde un aviso o al abrirla dos veces
        public void TraerAlFrente()
        {
            if (!Visible) return;                                  // todavía está cargando detrás de la bienvenida
            if (WindowState == FormWindowState.Minimized) ShowWindow(Handle, 9);   // SW_RESTORE
            Activate();
            SetForegroundWindow(Handle);
        }

        // el panel manda: { tipo: 'aviso', titulo, texto, ir: { a, proyecto } } (src/lib/appEscritorio.js)
        void MensajeDelPanel(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!Programa.EsDelPanel(e.Source)) return;            // solo el panel puede pedir avisos
            Dictionary<string, object> m;
            try { m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); } catch { return; }
            if (m == null || Texto(m, "tipo") != "aviso") return;
            // mirando la ventana no hace falta: el panel ya lo muestra en pantalla
            if (ActiveForm == this && WindowState != FormWindowState.Minimized) return;
            object ir;
            avisoIr = m.TryGetValue("ir", out ir) ? ir as Dictionary<string, object> : null;
            string titulo = Texto(m, "titulo"), texto = Texto(m, "texto");
            if (string.IsNullOrEmpty(titulo) && string.IsNullOrEmpty(texto)) return;
            avisoEsVersion = false;                                // este aviso lleva a una pantalla, no a actualizar
            bandeja.ShowBalloonTip(10000, string.IsNullOrEmpty(titulo) ? Programa.NOMBRE : titulo, string.IsNullOrEmpty(texto) ? " " : texto, ToolTipIcon.None);
        }

        static string Texto(Dictionary<string, object> m, string k)
        {
            object v;
            return m != null && m.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
        }

        void IrAlAviso()
        {
            if (avisoIr == null || web.CoreWebView2 == null) return;
            Dictionary<string, object> orden = new Dictionary<string, object>();
            orden["tipo"] = "ir";
            orden["a"] = Texto(avisoIr, "a");
            orden["proyecto"] = Texto(avisoIr, "proyecto");
            try { web.CoreWebView2.PostWebMessageAsJson(json.Serialize(orden)); } catch { }
            avisoIr = null;
        }

        // ------------------------------------------------ arranque detrás de la bienvenida
        const int MINIMO_BIENVENIDA_MS = 3000;   // la bienvenida se ve al menos 3 s
        const int MAXIMO_ESPERA_MS = 20000;      // si el panel tarda más, se muestra igual
        Bienvenida bienvenida;
        ApplicationContext contexto;
        bool mostrada, cargando, empezarMinimizada;

        public async void Preparar(Bienvenida b, ApplicationContext ctx, bool minimizada)
        {
            bienvenida = b; contexto = ctx; empezarMinimizada = minimizada;
            // la ventana existe pero no se ve: el panel carga mientras tanto
            CreateControl();
            IntPtr asa = web.Handle;
            Timer tope = new Timer { Interval = MAXIMO_ESPERA_MS };
            tope.Tick += (s, e) => { tope.Stop(); Mostrar(); };
            tope.Start();
            await Iniciar();
        }

        void Estado(string t) { if (bienvenida != null && !bienvenida.IsDisposed) bienvenida.Estado = t; }

        async void Mostrar()
        {
            if (mostrada) return;
            mostrada = true;
            if (bienvenida != null && !bienvenida.IsDisposed)
            {
                Estado("Listo");
                long falta = MINIMO_BIENVENIDA_MS - bienvenida.Milisegundos;
                if (falta > 0) await Task.Delay((int)falta);
            }
            if (empezarMinimizada)
            {
                // al prender la PC: queda en la barra de tareas, lista para los avisos
                maximizarAlVolver = WindowState == FormWindowState.Maximized;
                WindowState = FormWindowState.Minimized;
                Show();
            }
            else { Show(); Activate(); }
            BuscarVersionNueva();
            if (contexto != null) contexto.MainForm = this;       // cerrar esta ventana cierra la app
            if (bienvenida != null && !bienvenida.IsDisposed)
            {
                await Task.Delay(200);                            // que el panel alcance a dibujarse debajo
                bienvenida.Salir();
            }
        }

        async Task Iniciar()
        {
            try
            {
                CoreWebView2EnvironmentOptions opciones = new CoreWebView2EnvironmentOptions(null, "es");
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Programa.CarpetaDatos, "Datos"), opciones);
                Estado("Conectando con el servidor…");
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo iniciar la ventana del panel:\n\n" + ex.Message + "\n\nUsa el panel en el navegador mientras tanto.", Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Programa.AbrirAfuera(Programa.PANEL);
                Application.Exit();
                return;
            }
            CoreWebView2 cw = web.CoreWebView2;
            CoreWebView2Settings st = cw.Settings;
            st.UserAgent = st.UserAgent + " UrbisEscritorio/" + Programa.VERSION;   // el panel puede saber que es la app
            st.IsPasswordAutosaveEnabled = true;
            st.IsGeneralAutofillEnabled = true;
            st.IsZoomControlEnabled = true;
            st.AreDevToolsEnabled = true;          // F12 > Red: sirve para medir la velocidad

            cw.DocumentTitleChanged += (s, e) =>
            {
                string t = cw.DocumentTitle;
                Text = string.IsNullOrWhiteSpace(t) || t.StartsWith("http") || t.StartsWith("data:") ? Programa.NOMBRE : t;
            };
            cw.NavigationStarting += Navegando;
            cw.NavigationCompleted += Navegado;
            cw.NewWindowRequested += VentanaNueva;
            cw.ContextMenuRequested += MenuContextual;
            cw.ProcessFailed += MotorCaido;
            cw.WebMessageReceived += MensajeDelPanel;
            cw.Navigate(inicio);
        }

        // ¿la ventana principal se va a otro sitio? Eso se abre en el navegador
        void Navegando(object s, CoreWebView2NavigationStartingEventArgs e)
        {
            string u = e.Uri ?? "";
            if (!cargando) { cargando = true; Estado("Cargando el panel…"); }
            if (u.EndsWith("#urbis-abrir-en-navegador"))
            {
                e.Cancel = true; canceladas.Add(e.NavigationId);
                Programa.AbrirAfuera(Programa.PANEL);
                return;
            }
            if (u.StartsWith("data:") || u.StartsWith("about:") || u.StartsWith("blob:") || Programa.EsDelPanel(u)) return;
            e.Cancel = true; canceladas.Add(e.NavigationId);
            Programa.AbrirAfuera(u);
        }

        // sin internet (o el servidor no contesta): pantalla propia en vez del error en inglés
        void Navegado(object s, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (canceladas.Remove(e.NavigationId)) return;
            CoreWebView2WebErrorStatus st = e.WebErrorStatus;
            if (!e.IsSuccess && st != CoreWebView2WebErrorStatus.OperationCanceled && st != CoreWebView2WebErrorStatus.Unknown)
            {
                web.CoreWebView2.NavigateToString(PaginaSinConexion(st.ToString()));   // al terminar de dibujarla, se muestra
                return;
            }
            Mostrar();
        }

        // ventanas nuevas: las del panel (imprimir, vouchers) se quedan en la app;
        // WhatsApp, Google y el resto van al navegador
        void VentanaNueva(object s, CoreWebView2NewWindowRequestedEventArgs e)
        {
            string u = e.Uri ?? "";
            if (u == "" || u.StartsWith("about:") || u.StartsWith("blob:") || u.StartsWith("data:") || Programa.EsDelPanel(u) || EsArchivo(u)) return;
            e.Handled = true;
            Programa.AbrirAfuera(u);
        }

        // vouchers, contratos y fotos (Cloudflare R2 y el servidor de la base)
        static bool EsArchivo(string u)
        {
            Uri x;
            if (!Uri.TryCreate(u, UriKind.Absolute, out x) || x.Scheme != Uri.UriSchemeHttps) return false;
            string h = x.Host.ToLowerInvariant();
            return h.EndsWith(".r2.dev") || h == "api.urbisgroupinmobiliaria.com";
        }

        void MenuContextual(object s, CoreWebView2ContextMenuRequestedEventArgs e)
        {
            CoreWebView2Environment env = web.CoreWebView2.Environment;
            string actual = web.CoreWebView2.Source;
            CoreWebView2ContextMenuItem abrir = env.CreateContextMenuItem("Abrir esta página en el navegador", null, CoreWebView2ContextMenuItemKind.Command);
            abrir.CustomItemSelected += (a, b) => Programa.AbrirAfuera(Programa.EsDelPanel(actual) ? actual : Programa.PANEL);
            CoreWebView2ContextMenuItem recargar = env.CreateContextMenuItem("Recargar (F5)", null, CoreWebView2ContextMenuItemKind.Command);
            recargar.CustomItemSelected += (a, b) => web.CoreWebView2.Reload();
            e.MenuItems.Add(env.CreateContextMenuItem("", null, CoreWebView2ContextMenuItemKind.Separator));
            e.MenuItems.Add(abrir);
            e.MenuItems.Add(recargar);
            CoreWebView2ContextMenuItem alPrender = env.CreateContextMenuItem("Abrir al prender la PC", null, CoreWebView2ContextMenuItemKind.CheckBox);
            alPrender.IsChecked = AlPrender.Activo;
            alPrender.CustomItemSelected += (a, b) => BeginInvoke(new Action(CambiarAlPrender));
            e.MenuItems.Add(alPrender);
        }

        void MotorCaido(object s, CoreWebView2ProcessFailedEventArgs e)
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                BeginInvoke(new Action(() => { try { web.CoreWebView2.Reload(); } catch { } }));
            }
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                BeginInvoke(new Action(() =>
                {
                    MessageBox.Show("La ventana del panel se cerró por un problema de Windows. Vuelve a abrir Urbis Control.", Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    Close();
                }));
            }
        }

        static string PaginaSinConexion(string motivo)
        {
            return "<!doctype html><html lang='es'><head><meta charset='utf-8'><title>Urbis Control</title><style>"
                + "body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F6F0;font-family:'Segoe UI',sans-serif;color:#2b3a24}"
                + ".c{max-width:460px;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#55624d;line-height:1.5}"
                + "a{display:inline-block;margin:8px 6px;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}"
                + ".p{background:#3B4D32;color:#fff}.s{border:1px solid #8C9C7A;color:#3B4D32}small{color:#8C9C7A}</style></head><body><div class='c'>"
                + "<h1>No se pudo abrir el panel</h1>"
                + "<p>Revisa que la computadora tenga internet. Si el internet está bien, prueba abrir el panel en el navegador.</p>"
                + "<a class='p' href='" + Programa.PANEL + "'>Reintentar</a>"
                + "<a class='s' href='" + Programa.PANEL + "#urbis-abrir-en-navegador'>Abrir en el navegador</a>"
                + "<p><small>Detalle: " + System.Net.WebUtility.HtmlEncode(motivo) + "</small></p>"
                + "</div></body></html>";
        }

        string ArchivoVentana { get { return Path.Combine(Programa.CarpetaDatos, "ventana.txt"); } }

        void RestaurarPosicion()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1366, area.Width), Math.Min(820, area.Height));
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
            bool maximizada = true;                       // la primera vez, a pantalla completa
            try
            {
                string[] p = File.ReadAllText(ArchivoVentana).Split(',');
                Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                maximizada = p[4].Trim() == "1";
                foreach (Screen sc in Screen.AllScreens)
                    if (sc.WorkingArea.IntersectsWith(r)) { Bounds = r; break; }   // si esa pantalla ya no está, al centro
            }
            catch { }
            if (maximizada) WindowState = FormWindowState.Maximized;
        }

        void GuardarPosicion()
        {
            try
            {
                Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Directory.CreateDirectory(Programa.CarpetaDatos);
                File.WriteAllText(ArchivoVentana, r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (WindowState == FormWindowState.Maximized ? "1" : "0"));
            }
            catch { }
        }
    }

    // ------------------------------------------------------------ ABRIR AL PRENDER LA PC (v1.2)
    // La casilla del ícono del reloj (y del clic derecho): pone o quita a Urbis Control en el
    // inicio de Windows de ESTA persona (HKCU\...\Run). Arranca minimizada, sin bienvenida.
    static class AlPrender
    {
        const string RUN = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string VALOR = "UrbisControl";
        public static bool Activo
        {
            get
            {
                try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RUN)) return k != null && k.GetValue(VALOR) != null; }
                catch { return false; }
            }
        }
        public static void Poner(bool si)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RUN))
            {
                if (!si) { k.DeleteValue(VALOR, false); return; }
                // la copia instalada si existe (la descargada puede borrarse)
                string exe = File.Exists(Programa.ExeInstalado) ? Programa.ExeInstalado : Application.ExecutablePath;
                k.SetValue(VALOR, "\"" + exe + "\" --minimizada");
            }
        }
    }

    // ------------------------------------------------------------ BIENVENIDA
    // Se ve apenas se abre la app, mientras el panel carga escondido detrás. Se dibuja
    // a mano (sin WebView2) para que salga al instante. Colores del tema del panel.
    class Bienvenida : Form
    {
        public const string CREDITO = "By: Ing. César O'Higgins";

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int atributo, ref int valor, int tam);
        [DllImport("user32.dll")] static extern uint GetDpiForSystem();

        static readonly Color FONDO_1 = Color.FromArgb(0x1C, 0x2B, 0x21), FONDO_2 = Color.FromArgb(0x0A, 0x11, 0x0E);
        static readonly Color TEXTO = Color.FromArgb(0xEE, 0xF3, 0xEA), ACENTO = Color.FromArgb(0x9C, 0xCB, 0x86), ACENTO_2 = Color.FromArgb(0xBF, 0xE3, 0xA6);
        static readonly Color GRIS = Color.FromArgb(0x9A, 0xA8, 0x96), GRIS_2 = Color.FromArgb(0x6E, 0x7E, 0x71), PISTA = Color.FromArgb(0x24, 0x33, 0x2A);
        static readonly Color LOGO_CLARO = Color.FromArgb(0x8C, 0x9B, 0x7A), LOGO_OSCURO = Color.FromArgb(0x3B, 0x4A, 0x32);

        readonly Timer reloj = new Timer();
        readonly Stopwatch desde = Stopwatch.StartNew();
        readonly float k;                     // escala de la pantalla (125 %, 150 %…)
        string estado = "Iniciando…";
        bool saliendo;

        public Bienvenida()
        {
            float dpi = 96;
            try { dpi = GetDpiForSystem(); } catch { }
            k = dpi / 96f;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            Text = Programa.NOMBRE;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            ClientSize = new Size(E(480), E(320));
            BackColor = FONDO_2;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            Opacity = 0;                      // entra con un fundido
            reloj.Interval = 15;
            reloj.Tick += Paso;
            reloj.Start();
        }

        public string Estado { set { estado = value; Invalidate(); } }
        public long Milisegundos { get { return desde.ElapsedMilliseconds; } }
        public void Salir() { TopMost = true; saliendo = true; }   // fundido de salida sobre el panel

        float F(float v) { return v * k; }
        int E(float v) { return (int)Math.Round(v * k); }

        protected override CreateParams CreateParams
        {
            get { CreateParams cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; }   // sombra
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int redondo = 2;                  // esquinas redondeadas de Windows 11
            try { DwmSetWindowAttribute(Handle, 33, ref redondo, 4); } catch { }
        }

        void Paso(object s, EventArgs e)
        {
            if (saliendo)
            {
                Opacity = Math.Max(0, Opacity - 0.08);
                if (Opacity <= 0) { reloj.Stop(); Close(); return; }
            }
            else if (Opacity < 1) Opacity = Math.Min(1, Opacity + 0.07);
            Invalidate();
        }

        protected override void OnFormClosed(FormClosedEventArgs e) { reloj.Stop(); reloj.Dispose(); base.OnFormClosed(e); }

        static GraphicsPath Redondeado(float x, float y, float w, float h, float r)
        {
            GraphicsPath p = new GraphicsPath();
            float d = Math.Min(r * 2, Math.Min(w, h));
            p.AddArc(x, y, d, d, 180, 90);
            p.AddArc(x + w - d, y, d, d, 270, 90);
            p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            p.AddArc(x, y + h - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        // el logo de Urbis: los mismos polígonos de src/components/Logo.jsx (viewBox 100)
        static void DibujarLogo(Graphics g, float x0, float y0, float lado)
        {
            float s = lado / 84f;                                    // el dibujo ocupa x 8-92, y 4-64
            float ox = x0 - 8 * s, oy = y0 + (lado - 60 * s) / 2f - 4 * s;
            float[][] piezas = {
                new float[] { 50,4, 63,17, 50,30, 37,17 }, new float[] { 33,14, 47,26, 47,64, 33,52 },
                new float[] { 67,14, 53,26, 53,64, 67,52 }, new float[] { 8,50, 30,50, 44,64, 22,64 },
                new float[] { 92,50, 70,50, 56,64, 78,64 } };
            bool[] oscura = { false, false, true, false, true };
            for (int i = 0; i < piezas.Length; i++)
            {
                PointF[] pts = new PointF[4];
                for (int j = 0; j < 4; j++) pts[j] = new PointF(ox + piezas[i][j * 2] * s, oy + piezas[i][j * 2 + 1] * s);
                using (SolidBrush b = new SolidBrush(oscura[i] ? LOGO_OSCURO : LOGO_CLARO)) g.FillPolygon(b, pts);
            }
        }

        // texto con letras separadas (como el título del login)
        static float Ancho(Graphics g, string t, Font f, float esp)
        {
            float w = 0;
            foreach (char c in t) w += g.MeasureString(c.ToString(), f, PointF.Empty, StringFormat.GenericTypographic).Width + esp;
            return w - esp;
        }
        static void Letras(Graphics g, string t, Font f, float x, float y, float esp, Color color)
        {
            using (SolidBrush b = new SolidBrush(color))
                foreach (char c in t)
                {
                    g.DrawString(c.ToString(), f, b, x, y, StringFormat.GenericTypographic);
                    x += g.MeasureString(c.ToString(), f, PointF.Empty, StringFormat.GenericTypographic).Width + esp;
                }
        }
        static void Centrado(Graphics g, string t, Font f, Color color, float ancho, float y)
        {
            using (SolidBrush b = new SolidBrush(color))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center })
                g.DrawString(t, f, b, new RectangleF(0, y, ancho, f.GetHeight(g) * 1.5f), sf);
        }

        protected override void OnPaint(PaintEventArgs pe)
        {
            Graphics g = pe.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAlias;      // ClearType se ve mal en ventanas con fundido
            int W = ClientSize.Width, H = ClientSize.Height;

            // fondo: el degradé verde bosque del panel + un resplandor detrás del logo
            using (LinearGradientBrush b = new LinearGradientBrush(new Rectangle(0, 0, W, H), FONDO_1, FONDO_2, 60f)) g.FillRectangle(b, 0, 0, W, H);
            using (GraphicsPath brillo = new GraphicsPath())
            {
                brillo.AddEllipse(W / 2f - F(190), F(-70), F(380), F(300));
                using (PathGradientBrush pb = new PathGradientBrush(brillo))
                {
                    pb.CenterColor = Color.FromArgb(40, ACENTO);
                    pb.SurroundColors = new Color[] { Color.FromArgb(0, ACENTO) };
                    g.FillPath(pb, brillo);
                }
            }
            using (Pen borde = new Pen(Color.FromArgb(38, ACENTO), 1)) g.DrawRectangle(borde, 0, 0, W - 1, H - 1);

            // el logo en su azulejo blanco, con sombra suave
            float t = F(84), tx = (W - t) / 2f, ty = F(42);
            for (int i = 6; i >= 1; i--)
                using (GraphicsPath sp = Redondeado(tx - F(i), ty + F(5) - F(i) * 0.6f, t + F(i * 2), t + F(i * 2), F(22 + i)))
                using (SolidBrush sb = new SolidBrush(Color.FromArgb(11, 0, 0, 0))) g.FillPath(sb, sp);
            using (GraphicsPath az = Redondeado(tx, ty, t, t, F(22)))
            using (SolidBrush wb = new SolidBrush(Color.White)) g.FillPath(wb, az);
            DibujarLogo(g, tx + F(11), ty + F(11), t - F(22));

            // | URBIS CONTROL
            using (Font f = new Font("Segoe UI", F(24), FontStyle.Bold, GraphicsUnit.Pixel))
            {
                float esp = F(2.4f), hueco = F(10), barra = F(5), sepBarra = F(12);
                float wa = Ancho(g, "URBIS", f, esp), wc = Ancho(g, "CONTROL", f, esp);
                float x = (W - (barra + sepBarra + wa + hueco + wc)) / 2f, y = F(146);
                float altoMay = F(18), yb = y + F(7);
                for (int i = 3; i >= 1; i--)
                    using (GraphicsPath gp = Redondeado(x - F(i * 1.5f), yb - F(i * 1.5f), barra + F(i * 3), altoMay + F(i * 3), F(4 + i)))
                    using (SolidBrush gb = new SolidBrush(Color.FromArgb(22, ACENTO_2))) g.FillPath(gb, gp);
                using (GraphicsPath bp = Redondeado(x, yb, barra, altoMay, F(3)))
                using (SolidBrush bb = new SolidBrush(ACENTO_2)) g.FillPath(bb, bp);
                Letras(g, "URBIS", f, x + barra + sepBarra, y, esp, TEXTO);
                Letras(g, "CONTROL", f, x + barra + sepBarra + wa + hueco, y, esp, ACENTO);
            }
            using (Font f = new Font("Segoe UI", F(13.5f), FontStyle.Regular, GraphicsUnit.Pixel))
                Centrado(g, "Sistema de gestión inmobiliaria", f, GRIS, W, F(184));

            // barra de carga que va y viene
            float bw = F(210), bh = F(4), bx = (W - bw) / 2f, by = F(228);
            using (GraphicsPath pista = Redondeado(bx, by, bw, bh, bh / 2))
            {
                using (SolidBrush pb = new SolidBrush(PISTA)) g.FillPath(pb, pista);
                float p = (desde.ElapsedMilliseconds % 1600) / 1600f;
                float ease = p < .5f ? 2 * p * p : 1 - (float)Math.Pow(-2 * p + 2, 2) / 2;
                float sw = bw * 0.36f, sx = bx - sw + (bw + sw) * ease;
                Region antes = g.Clip;
                g.SetClip(pista);
                using (LinearGradientBrush lb = new LinearGradientBrush(new RectangleF(sx - 1, by, sw + 2, bh), Color.FromArgb(0, ACENTO), ACENTO_2, 0f))
                    g.FillRectangle(lb, sx, by, sw, bh);
                g.Clip = antes;
            }
            using (Font f = new Font("Segoe UI", F(12), FontStyle.Regular, GraphicsUnit.Pixel))
                Centrado(g, estado, f, GRIS_2, W, F(242));

            // pie: el crédito, en letra chica
            using (Pen linea = new Pen(Color.FromArgb(40, ACENTO), 1)) g.DrawLine(linea, W / 2f - F(28), H - F(46), W / 2f + F(28), H - F(46));
            using (Font f = new Font("Segoe UI", F(11.5f), FontStyle.Regular, GraphicsUnit.Pixel))
                Centrado(g, CREDITO, f, GRIS_2, W, H - F(36));
            using (Font f = new Font("Segoe UI", F(10), FontStyle.Regular, GraphicsUnit.Pixel))
            using (SolidBrush vb = new SolidBrush(Color.FromArgb(0x4A, 0x58, 0x4E)))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Far })
                g.DrawString("v" + Programa.VERSION, f, vb, new RectangleF(0, H - F(22), W - F(12), F(16)), sf);
        }
    }

    // ------------------------------------------------------------ INSTALAR / DESINSTALAR
    static class Instalador
    {
        const string CLAVE = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\UrbisControl";
        static string AccesoEscritorio { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Programa.NOMBRE + ".lnk"); } }
        static string AccesoInicio { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Programa.NOMBRE + ".lnk"); } }

        public static bool CorriendoInstalado()
        {
            return string.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(Programa.ExeInstalado), StringComparison.OrdinalIgnoreCase);
        }

        // true = ya se abrió la copia instalada (esta se cierra); false = seguir con esta
        public static bool Ofrecer(bool sinPreguntar)
        {
            string instalada = null;
            if (File.Exists(Programa.ExeInstalado))
                try { instalada = FileVersionInfo.GetVersionInfo(Programa.ExeInstalado).FileVersion; } catch { }
            string esta = FileVersionInfo.GetVersionInfo(Application.ExecutablePath).FileVersion;
            if (instalada != null && instalada == esta) return Abrir(Programa.ExeInstalado);   // ya está: abrir esa

            if (!sinPreguntar)
            {
                string pregunta = instalada == null
                    ? "¿Instalar Urbis Control en esta computadora?\n\nSe crea el acceso directo en el Escritorio y en el menú Inicio.\n\nEs el mismo panel de siempre en su propia ventana: la web sigue funcionando igual en el navegador."
                    : "Llegó una versión nueva de Urbis Control (" + esta + ").\n\n¿Actualizar la que está instalada (" + instalada + ")?";
                if (MessageBox.Show(pregunta, Programa.NOMBRE, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return false;
            }
            try { Instalar(); }
            catch (IOException)
            {
                MessageBox.Show("No se pudo instalar porque Urbis Control está abierto.\n\nCiérralo y vuelve a abrir este archivo.", Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo instalar:\n\n" + ex.Message + "\n\nSe abre sin instalar.", Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            return Abrir(Programa.ExeInstalado);
        }

        static void Instalar()
        {
            Directory.CreateDirectory(Programa.CarpetaInstalacion);
            byte[] exe = File.ReadAllBytes(Application.ExecutablePath);
            File.WriteAllBytes(Programa.ExeInstalado, exe);         // la copia instalada es un archivo nuevo
            CrearAcceso(AccesoEscritorio);
            CrearAcceso(AccesoInicio);
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(CLAVE))
            {
                k.SetValue("DisplayName", Programa.NOMBRE);
                k.SetValue("DisplayVersion", Programa.VERSION);
                k.SetValue("Publisher", "Urbis Group");
                k.SetValue("DisplayIcon", Programa.ExeInstalado);
                k.SetValue("InstallLocation", Programa.CarpetaInstalacion);
                k.SetValue("UninstallString", "\"" + Programa.ExeInstalado + "\" --desinstalar");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", exe.Length / 1024, RegistryValueKind.DWord);
            }
        }

        static void CrearAcceso(string lnk)
        {
            Type tipo = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(tipo);
            try
            {
                object acc = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                Type ta = acc.GetType();
                ta.InvokeMember("TargetPath", BindingFlags.SetProperty, null, acc, new object[] { Programa.ExeInstalado });
                ta.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, acc, new object[] { Programa.CarpetaInstalacion });
                ta.InvokeMember("IconLocation", BindingFlags.SetProperty, null, acc, new object[] { Programa.ExeInstalado + ",0" });
                ta.InvokeMember("Description", BindingFlags.SetProperty, null, acc, new object[] { "Panel de Urbis Control" });
                ta.InvokeMember("Save", BindingFlags.InvokeMethod, null, acc, null);
                Marshal.FinalReleaseComObject(acc);
            }
            finally { Marshal.FinalReleaseComObject(shell); }
        }

        static bool Abrir(string exe)
        {
            try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) }); return true; }
            catch { return false; }
        }

        public static int Desinstalar(bool silencioso)
        {
            if (!silencioso && MessageBox.Show("¿Desinstalar Urbis Control de esta computadora?\n\nEl panel sigue funcionando igual en el navegador.",
                Programa.NOMBRE, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
            foreach (string f in new string[] { AccesoEscritorio, AccesoInicio })
                try { if (File.Exists(f)) File.Delete(f); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(CLAVE, false); } catch { }
            try { AlPrender.Poner(false); } catch { }
            // el .exe no puede borrarse a sí mismo mientras corre: cmd borra las carpetas
            // (el programa y su sesión/caché) unos segundos después de que se cierre
            string orden = "/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"" + Programa.CarpetaInstalacion + "\" & rmdir /s /q \"" + Programa.CarpetaDatos + "\"";
            try { Process.Start(new ProcessStartInfo("cmd.exe", orden) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
            if (!silencioso) MessageBox.Show("Urbis Control se desinstaló.\n\nEl panel sigue en el navegador: " + Programa.PANEL, Programa.NOMBRE, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }
}
