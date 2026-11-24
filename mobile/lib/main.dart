import 'dart:async';
import 'dart:convert';

// Keep Flutter's bundled Material API for compatibility with stable SDKs.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'ride.dart';
import 'tracker.dart';
import 'group_tools.dart';

const url = String.fromEnvironment('SUPABASE_URL');
const publicKey = String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY',
    defaultValue: String.fromEnvironment('SUPABASE_ANON_KEY'));

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RadarApp());
}

class RadarApp extends StatelessWidget {
  const RadarApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Selfie Bike Radar',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff163c36))
              .copyWith(
                  primary: const Color(0xff163c36),
                  secondary: const Color(0xffd5fb68)),
          useMaterial3: true,
        ),
        home: const Configuration(),
      );
}

class Configuration extends StatefulWidget {
  const Configuration({super.key});
  @override
  State<Configuration> createState() => _ConfigurationState();
}

class _ConfigurationState extends State<Configuration> {
  final endpoint = TextEditingController();
  final key = TextEditingController();
  bool ready = false;
  bool waiting = false;
  String? error;
  @override
  void initState() {
    super.initState();
    unawaited(restore());
  }

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    endpoint.text =
        url.isNotEmpty ? url : prefs.getString('radar.public.url') ?? '';
    key.text = publicKey.isNotEmpty
        ? publicKey
        : prefs.getString('radar.public.key') ?? '';
    if (endpoint.text.isNotEmpty && key.text.isNotEmpty) await connect();
  }

  Future<void> connect() async {
    setState(() {
      waiting = true;
      error = null;
    });
    try {
      final uri = Uri.tryParse(endpoint.text.trim());
      if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
        throw StateError('Escribe la URL HTTPS de tu proyecto Supabase.');
      }
      final value = key.text.trim();
      var valid = value.startsWith('sb_publishable_');
      if (value.split('.').length == 3) {
        final claims = jsonDecode(
          utf8.decode(
            base64Url.decode(base64Url.normalize(value.split('.')[1])),
          ),
        );
        valid = claims['role'] == 'anon';
      }
      if (!valid) {
        throw StateError(
          'Usa una clave anon o sb_publishable_. Nunca service_role ni sb_secret_.',
        );
      }
      await Supabase.initialize(url: uri.toString(), publishableKey: value);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('radar.public.url', uri.toString());
      await prefs.setString('radar.public.key', value);
      ready = true;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => waiting = false);
  }

  @override
  void dispose() {
    endpoint.dispose();
    key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ready
      ? const SessionGate()
      : Scaffold(
          appBar: AppBar(title: const Text('Configurar Radar')),
          body: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Conecta tu proyecto Supabase. La URL y la clave pública se guardan solo en este dispositivo.',
                    ),
                    TextField(
                      controller: endpoint,
                      decoration: const InputDecoration(
                        labelText: 'URL pública de Supabase',
                      ),
                    ),
                    TextField(
                      controller: key,
                      decoration: const InputDecoration(
                        labelText: 'Clave anon / publishable',
                      ),
                    ),
                    if (error != null) Text(error!),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: waiting ? null : connect,
                      child: Text(
                        waiting ? 'Preparando…' : 'Guardar y continuar',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
}

class SessionGate extends StatelessWidget {
  const SessionGate({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = Supabase.instance.client.auth;
    return StreamBuilder<AuthState>(
      stream: auth.onAuthStateChange,
      builder: (context, snapshot) {
        final user = auth.currentUser;
        return user == null ? const Login() : Home(key: ValueKey(user.id));
      },
    );
  }
}

class Login extends StatefulWidget {
  const Login({super.key});
  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool waiting = false;
  String? message;
  Future<void> submit(bool register) async {
    setState(() {
      waiting = true;
      message = null;
    });
    try {
      final auth = Supabase.instance.client.auth;
      if (register) {
        final result = await auth.signUp(
          email: email.text.trim(),
          password: password.text,
        );
        if (result.session == null) {
          message =
              'Revisa tu correo para confirmar la cuenta y después inicia sesión.';
        }
      } else {
        await auth.signInWithPassword(
          email: email.text.trim(),
          password: password.text,
        );
      }
    } catch (e) {
      message = e is AuthException ? e.message : 'No fue posible conectar: $e';
    }
    if (mounted) setState(() => waiting = false);
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.radar, size: 64),
                  const SizedBox(height: 16),
                  Text(
                    'Tus rutas. Tu grupo.',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const Text(
                    'Registra recorridos GPS y compártelos con tu grupo privado.',
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Correo electrónico',
                    ),
                  ),
                  TextField(
                    controller: password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Contraseña'),
                  ),
                  if (message != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Text(message!),
                    ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: waiting ? null : () => submit(false),
                    child: Text(waiting ? 'Conectando…' : 'Iniciar sesión'),
                  ),
                  TextButton(
                    onPressed: waiting ? null : () => submit(true),
                    child: const Text('Crear cuenta'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
}

class Home extends StatefulWidget {
  const Home({super.key});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> with WidgetsBindingObserver {
  Tracker? tracker;
  Timer? ticker;
  String? selectedGroup;
  final name = TextEditingController(text: 'Mi recorrido');
  bool waiting = false;
  String? initialError;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(init());
    ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) return;
      tracker = Tracker(Supabase.instance.client, prefs)..addListener(changed);
      await tracker!.load();
    } catch (e) {
      initialError = '$e';
    }
    if (mounted) setState(() {});
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final t = tracker;
      if (t != null) unawaited(t.sync());
    }
  }

  Future<void> act(Future<void> Function() action) async {
    if (waiting) return;
    setState(() => waiting = true);
    try {
      await action();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => waiting = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ticker?.cancel();
    name.dispose();
    tracker?.removeListener(changed);
    tracker?.dispose();
    super.dispose();
  }

  Future<void> groupDialog(bool create) async {
    final value = TextEditingController();
    final member = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(create ? 'Crear grupo privado' : 'Unirme a un grupo'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: value,
              decoration: InputDecoration(
                labelText: create ? 'Nombre del grupo' : 'Código de invitación',
              ),
            ),
            TextField(
              controller: member,
              decoration: const InputDecoration(
                labelText: 'Tu nombre en el grupo',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              if (value.text.trim().isNotEmpty &&
                  member.text.trim().isNotEmpty) {
                Navigator.pop(context, true);
              }
            },
            child: const Text('Continuar'),
          ),
        ],
      ),
    );
    final v = value.text;
    final m = member.text;
    // Controllers are disposed after dialog transition finishes.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    value.dispose();
    member.dispose();
    if (accepted == true && mounted) {
      await act(() => tracker!.group(create, v, m));
    }
  }

  Future<void> export(Ride r) async {
    await tracker!.hydrate(r);
    if (!mounted) return;
    if (r.points.isEmpty) {
      throw StateError('Este recorrido no tiene puntos GPS.');
    }
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(utf8.encode(r.gpx()), mimeType: 'application/gpx+xml'),
        ],
        fileNameOverrides: ['radar-${r.id}.gpx'],
        sharePositionOrigin:
            box == null ? null : box.localToGlobal(Offset.zero) & box.size,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = tracker;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Selfie Bike Radar'),
        actions: [
          IconButton(
            tooltip: 'Sincronizar',
            onPressed: waiting || t == null ? null : () => act(t.refresh),
            icon: const Icon(Icons.sync),
          ),
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: waiting || t == null
                ? null
                : () => act(() async {
                      await t.pause();
                      await t.sync();
                      await Supabase.instance.client.auth.signOut();
                    }),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: initialError != null
          ? Center(child: Text(initialError!))
          : t == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      t.syncing
                          ? 'Sincronizando…'
                          : '${t.pending.length} recorridos pendientes de sincronizar',
                    ),
                    if (t.error != null)
                      Text(
                        t.error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    const SizedBox(height: 12),
                    const Text(
                      'Ubicación activa hasta pausar o finalizar. El sistema puede limitar el GPS con pantalla bloqueada; seguimiento en segundo plano pendiente de validar en dispositivo.',
                    ),
                    const SizedBox(height: 16),
                    if (t.current == null) ...[
                      TextField(
                        controller: name,
                        decoration: const InputDecoration(
                          labelText: 'Nombre del recorrido',
                        ),
                      ),
                      DropdownButtonFormField<String>(
                        initialValue: selectedGroup,
                        decoration: const InputDecoration(
                          labelText: 'Compartir con',
                        ),
                        items: [
                          const DropdownMenuItem(
                            value: null,
                            child: Text('Selecciona un grupo privado'),
                          ),
                          ...t.groups.map(
                            (g) => DropdownMenuItem(
                              value: g['id'] as String,
                              child: Text(g['name'] as String),
                            ),
                          ),
                        ],
                        onChanged: (v) => setState(() => selectedGroup = v),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: waiting
                            ? null
                            : () =>
                                act(() => t.start(name.text, selectedGroup)),
                        icon: const Icon(Icons.play_arrow),
                        label: const Text('Iniciar recorrido'),
                      ),
                    ] else ...[
                      Text(
                        t.current!.data['name'] as String,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        '${t.current!.active ? 'Grabando' : 'En pausa'} · ${((t.current!.data['distance_m'] as num) / 1000).toStringAsFixed(2)} km · ${duration(t.current!.durationMs(DateTime.now().toUtc()) ~/ 1000)}',
                      ),
                      const SizedBox(height: 12),
                      Text(
                          'Media: ${((t.current!.durationMs(DateTime.now().toUtc()) > 0 ? (t.current!.data['distance_m'] as num) / (t.current!.durationMs(DateTime.now().toUtc()) / 1000) * 3.6 : 0)).toStringAsFixed(1)} km/h · Máxima: ${((t.current!.data['max_speed_mps'] as num) * 3.6).toStringAsFixed(1)} km/h · Ascenso GPS: ${(t.current!.data['elevation_gain_m'] as num).toStringAsFixed(0)} m'),
                      RouteMap(ride: t.current!),
                      Wrap(
                        spacing: 12,
                        children: [
                          FilledButton(
                            onPressed: waiting
                                ? null
                                : () =>
                                    act(t.current!.active ? t.pause : t.resume),
                            child:
                                Text(t.current!.active ? 'Pausar' : 'Reanudar'),
                          ),
                          OutlinedButton(
                            onPressed: waiting ? null : () => act(t.finish),
                            child: const Text('Finalizar'),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 24),
                    if (t.current != null || selectedGroup != null) ...[
                      QuickAlerts(
                          groupId: (t.current?.data['group_id'] as String?) ??
                              selectedGroup,
                          groupName: t.groups
                                  .where((g) =>
                                      g['id'] ==
                                      ((t.current?.data['group_id']
                                              as String?) ??
                                          selectedGroup))
                                  .map((g) => g['name'] as String)
                                  .firstOrNull ??
                              'tu grupo'),
                      const SizedBox(height: 24),
                    ],
                    Text(
                      'Grupos privados',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    Wrap(
                      spacing: 12,
                      children: [
                        TextButton.icon(
                          onPressed: waiting ? null : () => groupDialog(true),
                          icon: const Icon(Icons.add),
                          label: const Text('Crear grupo'),
                        ),
                        TextButton.icon(
                          onPressed: waiting ? null : () => groupDialog(false),
                          icon: const Icon(Icons.group_add),
                          label: const Text('Unirme con código'),
                        ),
                      ],
                    ),
                    ...t.groups.map(
                      (g) => Card(
                        child: ListTile(
                          leading: const Icon(Icons.lock_outline),
                          title: Text(g['name'] as String),
                          subtitle: SelectableText(
                            'Código: ${g['invite_code'] ?? 'Disponible para el propietario'}',
                          ),
                          trailing: IconButton(
                            tooltip: 'Avisos y desempeño del grupo',
                            icon: const Icon(Icons.groups),
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => GroupTools(
                                    group: g,
                                    radarBuilder: (_) => GroupRadar(group: g)),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Historial',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (t.rides.where((r) => r.finished).isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child:
                            Text('Tus recorridos finalizados aparecerán aquí.'),
                      ),
                    ...t.rides.where((r) => r.finished).toList().reversed.map(
                          (r) => Card(
                            child: ListTile(
                              title: Text(r.data['name'] as String),
                              subtitle: Text(
                                '${r.data['started_at']}\n${((r.data['distance_m'] as num) / 1000).toStringAsFixed(2)} km · ${duration((r.data['duration_s'] as num).toInt())}',
                              ),
                              isThreeLine: true,
                              onTap: () => act(() async {
                                await t.hydrate(r);
                                if (!context.mounted) return;
                                await showModalBottomSheet<void>(
                                  context: context,
                                  isScrollControlled: true,
                                  builder: (_) => Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: SizedBox(
                                      height: 400,
                                      child: Column(
                                        children: [
                                          Text(r.data['name'] as String),
                                          const SizedBox(height: 12),
                                          Expanded(child: RouteMap(ride: r)),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              }),
                              trailing: IconButton(
                                tooltip: 'Exportar GPX',
                                onPressed:
                                    waiting ? null : () => act(() => export(r)),
                                icon: const Icon(Icons.ios_share),
                              ),
                            ),
                          ),
                        ),
                  ],
                ),
    );
  }
}

String duration(int seconds) =>
    '${(seconds ~/ 3600).toString().padLeft(2, '0')}:${(seconds ~/ 60 % 60).toString().padLeft(2, '0')}:${(seconds % 60).toString().padLeft(2, '0')}';

class RouteMap extends StatelessWidget {
  const RouteMap({super.key, required this.ride});
  final Ride ride;
  @override
  Widget build(BuildContext context) {
    final points = ride.points
        .map(
          (p) => LatLng(
            (p['latitude'] as num).toDouble(),
            (p['longitude'] as num).toDouble(),
          ),
        )
        .toList();
    final segments = <String, List<LatLng>>{};
    for (var i = 0; i < ride.points.length; i++) {
      segments
          .putIfAbsent(
              '${ride.points[i]['_segment'] ?? ride.points[i]['segment'] ?? 0}',
              () => [])
          .add(points[i]);
    }
    return SizedBox(
      height: 280,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: FlutterMap(
          key: ValueKey('${ride.id}.${points.isEmpty}'),
          options: MapOptions(
            initialCenter:
                points.isEmpty ? const LatLng(4.711, -74.0721) : points.last,
            initialZoom: 15,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'co.radar.mobile',
            ),
            PolylineLayer(
              polylines: segments.values
                  .map(
                    (ps) => Polyline(
                      points: ps,
                      strokeWidth: 5,
                      color: Color(0xff163c36),
                    ),
                  )
                  .toList(),
            ),
            if (points.isNotEmpty)
              MarkerLayer(
                markers: [
                  Marker(
                    point: points.last,
                    child: const Icon(
                      Icons.location_on,
                      color: Color(0xff163c36),
                      size: 36,
                    ),
                  ),
                ],
              ),
            const Align(
              alignment: Alignment.bottomRight,
              child: ColoredBox(
                color: Colors.white,
                child: Padding(
                  padding: EdgeInsets.all(4),
                  child: Text(
                    '© OpenStreetMap contributors',
                    style: TextStyle(color: Colors.black, fontSize: 10),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class GroupRadar extends StatefulWidget {
  const GroupRadar({super.key, required this.group});
  final Map<String, dynamic> group;
  @override
  State<GroupRadar> createState() => _GroupRadarState();
}

class _GroupRadarState extends State<GroupRadar> {
  Position? me;
  bool locating = false;
  Future<void> locate() async {
    setState(() {
      locating = true;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('Activa la ubicación del dispositivo.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw StateError(
            'Permiso denegado. Habilita ubicación en los ajustes.');
      }
      final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 20)));
      if (mounted) {
        setState(() {
          me = position;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = 'No se pudo obtener tu ubicación: $e';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          locating = false;
        });
      }
    }
  }

  List<Map<String, dynamic>> locations = [];
  Timer? timer;
  bool waiting = false;
  String? error;
  @override
  void initState() {
    super.initState();
    unawaited(refresh());
    timer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(refresh()),
    );
  }

  Future<void> refresh() async {
    if (waiting) return;
    waiting = true;
    // Remove stale positions even while the network is unavailable.
    if (mounted) {
      setState(
        () => locations.removeWhere(
          (p) =>
              DateTime.now()
                  .toUtc()
                  .difference(DateTime.parse(p['recorded_at'] as String))
                  .inSeconds >=
              120,
        ),
      );
    }
    try {
      final result = await Supabase.instance.client.rpc(
        'radar_live_locations',
        params: {'gid': widget.group['id']},
      );
      if (mounted) {
        setState(() {
          locations = (result as List)
              .map((p) => Map<String, dynamic>.from(p))
              .toList();
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = 'No se pudo actualizar el radar: $e');
    } finally {
      if (mounted) setState(() => waiting = false);
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(widget.group['name'] as String),
          actions: [
            IconButton(
              onPressed: waiting ? null : refresh,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: Column(
          children: [
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Solo salidas activas con ubicación de los últimos 2 minutos. Actualización cada 15 segundos.',
              ),
            ),
            if (error != null) Text(error!),
            TextButton.icon(
                onPressed: locating ? null : locate,
                icon: const Icon(Icons.my_location),
                label: Text(locating ? 'Obteniendo ubicación…' : 'Ubicarme')),
            if (me != null)
              Text(
                  'Tu posición: ${me!.timestamp.toLocal()} · precisión ${me!.accuracy.toStringAsFixed(0)} m'),
            Expanded(
              child: FlutterMap(
                key: ValueKey(locations.isEmpty),
                options: MapOptions(
                  initialCenter: locations.isEmpty
                      ? const LatLng(4.711, -74.0721)
                      : LatLng(
                          (locations.first['latitude'] as num).toDouble(),
                          (locations.first['longitude'] as num).toDouble(),
                        ),
                  initialZoom: 14,
                ),
                children: [
                  TileLayer(
                    urlTemplate:
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'co.radar.mobile',
                  ),
                  MarkerLayer(
                    markers: locations
                        .map(
                          (p) => Marker(
                            width: 150,
                            height: 70,
                            point: LatLng(
                              (p['latitude'] as num).toDouble(),
                              (p['longitude'] as num).toDouble(),
                            ),
                            child: Column(
                              children: [
                                const Icon(Icons.pedal_bike,
                                    color: Color(0xff163c36)),
                                Container(
                                  color: Colors.white,
                                  child: Text(
                                    p['display_name'] as String,
                                    style: const TextStyle(color: Colors.black),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                        .toList(),
                  ),
                  const Align(
                    alignment: Alignment.bottomRight,
                    child: ColoredBox(
                      color: Colors.white,
                      child: Text(
                        '© OpenStreetMap contributors',
                        style: TextStyle(color: Colors.black, fontSize: 10),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 180),
                child: ListView(
                    shrinkWrap: true,
                    children: locations.map((p) {
                      final speed = p['speed_mps'] as num?;
                      final distance = me == null
                          ? null
                          : Geolocator.distanceBetween(
                                  me!.latitude,
                                  me!.longitude,
                                  (p['latitude'] as num).toDouble(),
                                  (p['longitude'] as num).toDouble()) /
                              1000;
                      return ListTile(
                          dense: true,
                          title: Text(p['display_name'] as String),
                          subtitle: Text(
                              '${speed == null ? 'Velocidad no disponible' : '${(speed * 3.6).toStringAsFixed(1)} km/h'} · ${distance == null ? 'Activa Ubicarme para calcular' : '${distance.toStringAsFixed(2)} km en línea recta'}'));
                    }).toList())),
            if (locations.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No hay ubicaciones activas recientes.'),
              ),
          ],
        ),
      );
}
