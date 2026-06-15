/** Canonical M1 test manifest — mirrors engine/tests/m1_roundtrip.py output. */
export const M1_MANIFEST = {
  version: '1.0',
  template_id: 'm1-roundtrip-test',
  metadata: {
    name: 'M1 Round-trip Test',
    category: 'test',
    description: 'Synthetic template for Studio E2E',
  },
  parameters: [
    { id: 'intensity', type: 'float', label: 'Intensity', node_target: 'M1TestGroup', socket_identifier: 's0', default: 2.25, min: 0, max: 5 },
    { id: 'label', type: 'string', label: 'Label', node_target: 'M1TestGroup', socket_identifier: 's1', default: 'M1 DEMO LIVE' },
    { id: 'tint', type: 'color_rgba', label: 'Tint', node_target: 'M1TestGroup', socket_identifier: 's2', default: '#FF3366' },
    { id: 'enabled', type: 'bool', label: 'Enabled', node_target: 'M1TestGroup', socket_identifier: 's3', default: false },
    { id: 'count', type: 'int', label: 'Count', node_target: 'M1TestGroup', socket_identifier: 's4', default: 7, min: 0, max: 20 },
    { id: 'style_preset', type: 'enum', label: 'Style Preset', node_target: 'M1TestGroup', socket_identifier: 's5', default: 'glitch', options: ['plain', 'neon', 'glitch'] },
  ],
  slots: [
    { index: 0, label: 'Intro', start_time: 0, end_time: 2.0 },
    { index: 1, label: 'Hold', start_time: 2.0, end_time: 5.0 },
  ],
  slot_presets: [
    { id: 'fade_in', label: 'Fade In' },
    { id: 'hold', label: 'Hold' },
  ],
};

export const DEFAULT_TEMPLATE_PATH = 'C:\\\\TEMP\\\\m1_minimal_test.mo.blend';