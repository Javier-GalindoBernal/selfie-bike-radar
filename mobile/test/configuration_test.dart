// Keep Flutter's bundled Material API for compatibility with stable SDKs.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:radar_mobile/main.dart';

void main() {
  testWidgets('permite configuración local y rechaza claves secretas',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const RadarApp());
    await tester.pumpAndSettle();
    expect(find.text('Configurar Radar'), findsOneWidget);
    await tester.enterText(
        find.byType(TextField).at(0), 'https://example.supabase.co');
    await tester.enterText(find.byType(TextField).at(1), 'sb_secret_forbidden');
    await tester.tap(find.text('Guardar y continuar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Nunca service_role'), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('radar.public.key'), isNull);
  });
}
