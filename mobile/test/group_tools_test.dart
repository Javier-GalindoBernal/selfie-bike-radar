import 'dart:convert';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:radar_mobile/group_tools.dart';

void main() {
  test(
      'Los avisos solo se envían por confirmación explícita, con ID estable y sin ubicación por defecto',
      () async {
    final requests = <http.Request>[];
    final client = SupabaseClient('https://example.supabase.co', 'public-test',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
        httpClient: MockClient((r) async {
      requests.add(r);
      return http.Response(jsonEncode('stable-alert-id'), 200,
          headers: {'content-type': 'application/json'}, request: r);
    }));
    final api = GroupApi(client);
    await expectLater(
        api.send(groupId: 'group', kind: 'other', details: ' ', id: 'id'),
        throwsStateError);
    expect(requests, isEmpty);
    await api.send(
        groupId: 'group',
        kind: 'health',
        details: ' Necesito parar ',
        id: 'same-id');
    await api.send(
        groupId: 'group',
        kind: 'health',
        details: ' Necesito parar ',
        id: 'same-id');
    expect(requests.length, 2);
    final payload = jsonDecode(requests.first.body) as Map;
    expect(payload['client_id'], 'same-id');
    expect(payload['details'], 'Necesito parar');
    expect(payload['alert_lat'], isNull);
    expect(payload['alert_lng'], isNull);
    expect(requests.first.url.path, endsWith('/radar_send_alert'));
    expect(requests.first.body, requests.last.body);
    await client.dispose();
  });
  test('Desempeño solicita acumulado al servidor sin paginar a cien salidas',
      () async {
    http.Request? captured;
    final client = SupabaseClient('https://example.supabase.co', 'public-test',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
        httpClient: MockClient((r) async {
      captured = r;
      return http.Response(
          jsonEncode([
            {'user_id': 'one', 'distance_m': 112000, 'ride_count': 107}
          ]),
          200,
          headers: {'content-type': 'application/json'},
          request: r);
    }));
    final rows = await GroupApi(client).stats('group', 'all');
    expect(jsonDecode(captured!.body), {'gid': 'group', 'period': 'all'});
    expect(rows.single['ride_count'], 107);
    expect(rows.single['distance_m'], 112000);
    await client.dispose();
  });
  testWidgets('Cuatro botones y confirmación de salud antes de enviar',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: QuickAlerts(groupId: 'group', groupName: 'Bici amigos'))));
    expect(find.text('Pinchazo'), findsOneWidget);
    expect(find.text('Avería mecánica'), findsOneWidget);
    expect(find.text('Problema de salud'), findsOneWidget);
    expect(find.text('Otro aviso'), findsOneWidget);
    await tester.tap(find.text('Problema de salud'));
    await tester.pumpAndSettle();
    expect(
        find.text('Lo verán los integrantes de Bici amigos.'), findsOneWidget);
    expect(
        find.text(
            'Este aviso no realiza una llamada ni garantiza atención inmediata.'),
        findsOneWidget);
    expect(find.text('Avisar al grupo'), findsNWidgets(2));
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });
}
