import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import api from '../services/api';

export default function ReportIncidentScreen({ navigation }) {
  const [incidentType, setIncidentType] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [loading, setLoading] = useState(false);

  const submitIncident = async () => {
    if (!incidentType || !description) {
      Alert.alert('Missing info', 'Please fill in type and description');
      return;
    }
    setLoading(true);
    try {
      await api.post('/incidents/report', {
        incident_type: incidentType,
        description,
        severity,
      });
      Alert.alert('Success', 'Incident reported');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Report Incident</Text>
      <TextInput
        style={styles.input}
        placeholder="Incident Type"
        value={incidentType}
        onChangeText={setIncidentType}
        placeholderTextColor="#666"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        placeholderTextColor="#666"
      />
      <View style={styles.pickerContainer}>
        <Text style={styles.label}>Severity:</Text>
        <Picker
          selectedValue={severity}
          onValueChange={(itemValue) => setSeverity(itemValue)}
          style={styles.picker}
          dropdownIconColor="#fff"
        >
          <Picker.Item label="Low" value="low" />
          <Picker.Item label="Medium" value="medium" />
          <Picker.Item label="High" value="high" />
          <Picker.Item label="Critical" value="critical" />
        </Picker>
      </View>
      <TouchableOpacity style={styles.submitButton} onPress={submitIncident} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit Report</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  textArea: { height: 100, textAlignVertical: 'top' },
  pickerContainer: { marginBottom: 20 },
  label: { color: '#fff', marginBottom: 8 },
  picker: { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 8 },
  submitButton: { backgroundColor: '#dc2626', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
});