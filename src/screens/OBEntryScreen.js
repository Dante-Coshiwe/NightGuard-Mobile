import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import api from '../services/api';

export default function OBEntryScreen({ navigation }) {
  const [serialNumber, setSerialNumber] = useState('');
  const [nature, setNature] = useState('');
  const [loading, setLoading] = useState(false);

  const submitEntry = async () => {
    if (!nature) {
      Alert.alert('Missing info', 'Please enter the nature of occurrence');
      return;
    }
    setLoading(true);
    try {
      await api.post('/obentries', {
        serial_number: serialNumber,
        nature_of_occurrence: nature,
      });
      Alert.alert('Success', 'OB entry recorded');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to record');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Occurrence Book Entry</Text>
      <TextInput
        style={styles.input}
        placeholder="Serial Number (optional)"
        value={serialNumber}
        onChangeText={setSerialNumber}
        placeholderTextColor="#666"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Nature of Occurrence"
        value={nature}
        onChangeText={setNature}
        multiline
        numberOfLines={4}
        placeholderTextColor="#666"
      />
      <TouchableOpacity style={styles.submitButton} onPress={submitEntry} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit Entry</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  textArea: { height: 100, textAlignVertical: 'top' },
  submitButton: { backgroundColor: '#dc2626', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
});