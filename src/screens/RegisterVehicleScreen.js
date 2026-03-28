import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import api from '../services/api';

export default function RegisterVehicleScreen({ navigation }) {
  const [registration, setRegistration] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverContact, setDriverContact] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [loading, setLoading] = useState(false);

  const submitEntry = async () => {
    if (!registration) {
      Alert.alert('Missing info', 'Please enter registration number');
      return;
    }
    setLoading(true);
    try {
      await api.post('/vehicles/entry', {
        license_plate: registration,
        driver_name: driverName,
        driver_contact: driverContact,
        vehicle_type: vehicleType,
        visiting_unit: visitingUnit,
      });
      Alert.alert('Success', 'Vehicle registered');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register Vehicle Entry</Text>
      <TextInput
        style={styles.input}
        placeholder="Registration Number"
        value={registration}
        onChangeText={setRegistration}
        placeholderTextColor="#666"
      />
      <TextInput
        style={styles.input}
        placeholder="Driver Name"
        value={driverName}
        onChangeText={setDriverName}
        placeholderTextColor="#666"
      />
      <TextInput
        style={styles.input}
        placeholder="Driver Contact"
        value={driverContact}
        onChangeText={setDriverContact}
        placeholderTextColor="#666"
      />
      <TextInput
        style={styles.input}
        placeholder="Vehicle Type"
        value={vehicleType}
        onChangeText={setVehicleType}
        placeholderTextColor="#666"
      />
      <TextInput
        style={styles.input}
        placeholder="Visiting Unit"
        value={visitingUnit}
        onChangeText={setVisitingUnit}
        placeholderTextColor="#666"
      />
      <TouchableOpacity style={styles.submitButton} onPress={submitEntry} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register Entry</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  submitButton: { backgroundColor: '#dc2626', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
});