import 'dart:async';
// Mantener la API Material incluida en el SDK estable.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

const alertLabels = <String, String>{
  'puncture': 'Pinchazo',
  'mechanical': 'Avería mecánica',
  'health': 'Problema de salud',
  'other': 'Otro aviso'
};
const alertIcons = <String, IconData>{
  'puncture': Icons.tire_repair,
  'mechanical': Icons.build_outlined,
  'health': Icons.health_and_safety_outlined,
  'other': Icons.more_horiz
};
String featureError(Object e) {
  final text = '$e';
  if (text.contains('PGRST202') ||
      text.contains('schema cache') ||
      text.contains('does not exist')) {
    return 'Falta activar los avisos y estadísticas nuevos en Supabase.';
  }
  if (e is TimeoutException ||
      text.contains('SocketException') ||
      text.contains('ClientException')) {
    return 'No se confirmó la operación. Revisa la lista antes de reintentar; necesitas internet.';
  }
  return text;
}

class GroupApi {
  GroupApi(this.client);
  final SupabaseClient client;
  Future<List<Map<String, dynamic>>> alerts(String gid) async =>
      (await client.rpc('radar_group_alerts', params: {'gid': gid}).timeout(
              const Duration(seconds: 12)) as List)
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
  Future<List<Map<String, dynamic>>> stats(String gid, String period) async =>
      (await client.rpc('radar_group_stats', params: {
        'gid': gid,
        'period': period
      }).timeout(const Duration(seconds: 12)) as List)
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
  Future<void> send(
      {required String groupId,
      required String kind,
      required String details,
      required String id,
      Position? position}) async {
    if (!alertLabels.containsKey(kind)) {
      throw StateError('Tipo de aviso incorrecto.');
    }
    if (details.trim().length > 280 ||
        (kind == 'other' && details.trim().isEmpty)) {
      throw StateError('Escribe un detalle de máximo 280 caracteres.');
    }
    await client.rpc('radar_send_alert', params: {
      'gid': groupId,
      'alert_kind': kind,
      'details': details.trim(),
      'client_id': id,
      'alert_lat': position?.latitude,
      'alert_lng': position?.longitude
    }).timeout(const Duration(seconds: 12));
  }

  Future<void> respond(String id, bool resolve) async {
    await client.rpc(resolve ? 'radar_resolve_alert' : 'radar_ack_alert',
        params: {'aid': id}).timeout(const Duration(seconds: 12));
  }
}

class QuickAlerts extends StatelessWidget {
  const QuickAlerts(
      {super.key, required this.groupId, required this.groupName, this.onSent});
  final String? groupId;
  final String groupName;
  final VoidCallback? onSent;
  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Avisar al grupo', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        Wrap(
            spacing: 8,
            runSpacing: 8,
            children: alertLabels.entries
                .map((entry) => OutlinedButton.icon(
                    onPressed: groupId == null
                        ? null
                        : () async {
                            final sent = await showDialog<bool>(
                                context: context,
                                barrierDismissible: false,
                                builder: (_) => AlertComposer(
                                    groupId: groupId!,
                                    groupName: groupName,
                                    kind: entry.key));
                            if (sent == true) onSent?.call();
                          },
                    icon: Icon(alertIcons[entry.key],
                        color:
                            entry.key == 'health' ? Colors.red.shade700 : null),
                    label: Text(entry.value)))
                .toList()),
        const SizedBox(height: 8),
        const Text(
            'Avisos al grupo con la app abierta e internet. No llaman a emergencias.',
            style: TextStyle(fontSize: 12)),
      ]);
}

class AlertComposer extends StatefulWidget {
  const AlertComposer(
      {super.key,
      required this.groupId,
      required this.groupName,
      required this.kind});
  final String groupId, groupName, kind;
  @override
  State<AlertComposer> createState() => _AlertComposerState();
}

class _AlertComposerState extends State<AlertComposer> {
  final text = TextEditingController();
  final id = const Uuid().v4();
  bool busy = false, locating = false;
  Position? position;
  String? error;
  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> locate() async {
    setState(() {
      locating = true;
      error = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('Activa la ubicación del teléfono.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw StateError(
            'No hay permiso de ubicación. Puedes enviar el aviso sin adjuntarla.');
      }
      final p = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 20)));
      if (mounted) setState(() => position = p);
    } catch (e) {
      if (mounted) setState(() => error = featureError(e));
    } finally {
      if (mounted) setState(() => locating = false);
    }
  }

  Future<void> send() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await GroupApi(Supabase.instance.client).send(
          groupId: widget.groupId,
          kind: widget.kind,
          details: text.text,
          id: id,
          position: position);
      if (mounted) {
        final messenger = ScaffoldMessenger.of(context);
        Navigator.pop(context, true);
        messenger.showSnackBar(
            const SnackBar(content: Text('Aviso publicado en el grupo.')));
      }
    } catch (e) {
      if (mounted) setState(() => error = featureError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: !busy,
      child: AlertDialog(
        title: Text(alertLabels[widget.kind]!),
        content: SingleChildScrollView(
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
              Text('Lo verán los integrantes de ${widget.groupName}.'),
              const SizedBox(height: 12),
              TextField(
                  controller: text,
                  maxLength: 280,
                  maxLines: 3,
                  enabled: !busy,
                  decoration: InputDecoration(
                      labelText: widget.kind == 'other'
                          ? '¿Qué necesitas comunicar?'
                          : 'Detalle (opcional)')),
              if (position == null)
                TextButton.icon(
                    onPressed: busy || locating ? null : locate,
                    icon: const Icon(Icons.my_location),
                    label: Text(locating
                        ? 'Obteniendo posición…'
                        : 'Adjuntar mi ubicación'))
              else
                Row(children: [
                  const Expanded(
                      child: Text('Ubicación adjunta solo para este aviso.')),
                  IconButton(
                      tooltip: 'Quitar ubicación',
                      onPressed:
                          busy ? null : () => setState(() => position = null),
                      icon: const Icon(Icons.close))
                ]),
              if (widget.kind == 'health')
                const Text(
                    'Este aviso no realiza una llamada ni garantiza atención inmediata.',
                    style: TextStyle(color: Colors.red)),
              if (error != null)
                Text(error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error)),
            ])),
        actions: [
          TextButton(
              onPressed: busy ? null : () => Navigator.pop(context, false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: busy || locating ? null : send,
              child: Text(busy ? 'Enviando…' : 'Avisar al grupo'))
        ],
      ));
}

class GroupTools extends StatelessWidget {
  const GroupTools(
      {super.key, required this.group, required this.radarBuilder});
  final Map<String, dynamic> group;
  final WidgetBuilder radarBuilder;
  @override
  Widget build(BuildContext context) => DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
            title: Text(group['name'] as String),
            actions: [
              IconButton(
                  tooltip: 'Radar',
                  onPressed: () => Navigator.push(
                      context, MaterialPageRoute<void>(builder: radarBuilder)),
                  icon: const Icon(Icons.radar))
            ],
            bottom: const TabBar(tabs: [
              Tab(icon: Icon(Icons.campaign_outlined), text: 'Avisos'),
              Tab(icon: Icon(Icons.bar_chart), text: 'Desempeño')
            ])),
        body: TabBarView(children: [
          GroupAlerts(group: group),
          MemberPerformance(groupId: group['id'] as String)
        ]),
      ));
}

class GroupAlerts extends StatefulWidget {
  const GroupAlerts({super.key, required this.group});
  final Map<String, dynamic> group;
  @override
  State<GroupAlerts> createState() => _GroupAlertsState();
}

class _GroupAlertsState extends State<GroupAlerts> {
  List<Map<String, dynamic>> alerts = [];
  String? error;
  bool busy = false;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    unawaited(refresh());
    timer = Timer.periodic(
        const Duration(seconds: 10), (_) => unawaited(refresh()));
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final result = await GroupApi(Supabase.instance.client)
          .alerts(widget.group['id'] as String);
      if (mounted) {
        setState(() {
          alerts = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = featureError(e));
    }
  }

  Future<void> respond(Map<String, dynamic> alert, bool own) async {
    setState(() => busy = true);
    try {
      await GroupApi(Supabase.instance.client)
          .respond(alert['id'] as String, own);
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = featureError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = Supabase.instance.client.auth.currentUser?.id;
    return RefreshIndicator(
        onRefresh: refresh,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          QuickAlerts(
              groupId: widget.group['id'] as String,
              groupName: widget.group['name'] as String,
              onSent: () => unawaited(refresh())),
          const SizedBox(height: 18),
          Text('${alerts.length} avisos activos',
              style: Theme.of(context).textTheme.titleMedium),
          const Text(
              'Los avisos caducan a las 24 horas. Desliza hacia abajo para actualizar.',
              style: TextStyle(fontSize: 12)),
          if (error != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Text(error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          if (alerts.isEmpty)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No hay avisos activos.')),
          ...alerts.map((a) {
            final own = a['user_id'] == uid;
            final acknowledged = a['acknowledged'] == true;
            return Card(
                color: a['kind'] == 'health' ? Colors.red.shade50 : null,
                child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                              '${alertLabels[a['kind']]} · ${a['display_name']}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 8),
                          if ((a['message'] as String).isNotEmpty)
                            Text(a['message'] as String),
                          Text(
                              'Publicado: ${DateTime.parse(a['created_at'] as String).toLocal()}'),
                          if (a['latitude'] != null)
                            SelectableText(
                                'Ubicación: ${a['latitude']}, ${a['longitude']}'),
                          Text('${a['ack_count']} compañeros se acercan'),
                          OutlinedButton(
                              onPressed: busy || (!own && acknowledged)
                                  ? null
                                  : () => respond(a, own),
                              child: Text(own
                                  ? 'Marcar resuelto'
                                  : acknowledged
                                      ? 'Ya avisaste que ayudas'
                                      : 'Me acerco a ayudar')),
                        ])));
          }),
        ]));
  }
}

class MemberPerformance extends StatefulWidget {
  const MemberPerformance({super.key, required this.groupId});
  final String groupId;
  @override
  State<MemberPerformance> createState() => _MemberPerformanceState();
}

class _MemberPerformanceState extends State<MemberPerformance> {
  String period = 'week';
  List<Map<String, dynamic>> rows = [];
  String? error;
  bool busy = false;
  Timer? timer;
  int generation = 0;
  @override
  void initState() {
    super.initState();
    unawaited(refresh());
    timer = Timer.periodic(
        const Duration(seconds: 30), (_) => unawaited(refresh()));
  }

  @override
  void dispose() {
    generation++;
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    final request = ++generation;
    setState(() => busy = true);
    try {
      final result = await GroupApi(Supabase.instance.client)
          .stats(widget.groupId, period);
      if (mounted && request == generation) {
        setState(() {
          rows = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted && request == generation) {
        setState(() => error = featureError(e));
      }
    } finally {
      if (mounted && request == generation) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final max = rows.fold<double>(
        1,
        (v, r) => (r['distance_m'] as num).toDouble() > v
            ? (r['distance_m'] as num).toDouble()
            : v);
    return RefreshIndicator(
        onRefresh: refresh,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Kilómetros y desempeño de cada integrante',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'week', label: Text('Semana')),
                ButtonSegment(value: 'month', label: Text('Mes')),
                ButtonSegment(value: 'all', label: Text('Total'))
              ],
              selected: {
                period
              },
              onSelectionChanged: (value) {
                setState(() {
                  period = value.single;
                  rows = [];
                });
                unawaited(refresh());
              }),
          const SizedBox(height: 10),
          const Text(
              'Todas las salidas finalizadas de este grupo. Tiempo activo sin pausas manuales.',
              style: TextStyle(fontSize: 12)),
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Text(error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ...rows.indexed.map((entry) {
            final (index, r) = entry;
            return Card(
                child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${index + 1}. ${r['display_name']}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 18)),
                          const SizedBox(height: 10),
                          Text(
                              '${((r['distance_m'] as num) / 1000).toStringAsFixed(2)} km · ${r['ride_count']} salidas',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 8),
                          LinearProgressIndicator(
                              value: (r['distance_m'] as num) / max),
                          const SizedBox(height: 10),
                          Text(
                              'Tiempo activo: ${((r['duration_s'] as num) / 3600).toStringAsFixed(1)} h'),
                          Text(
                              'Media: ${(r['avg_speed_kmh'] as num).toStringAsFixed(1)} km/h · Máxima: ${(r['max_speed_kmh'] as num).toStringAsFixed(1)} km/h'),
                          Text(
                              'Ascenso GPS: ${(r['elevation_gain_m'] as num).toStringAsFixed(0)} m'),
                        ])));
          }),
          if (rows.isEmpty && !busy && error == null)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Aún no hay estadísticas para este periodo.')),
          const Text(
              'Ascenso y velocidades dependen del GPS. Las salidas anteriores pueden no incluir máximas ni ascenso. Pulso, potencia y cadencia requieren sensores.',
              style: TextStyle(fontSize: 12)),
        ]));
  }
}
