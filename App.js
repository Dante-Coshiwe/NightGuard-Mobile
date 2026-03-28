import React from 'react';
import { TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import PatrolsScreen from './src/screens/PatrolsScreen';
import PatrolDetailScreen from './src/screens/PatrolDetailScreen';
import RegisterPedestrianScreen from './src/screens/RegisterPedestrianScreen';
import RegisterVehicleScreen from './src/screens/RegisterVehicleScreen';
import ReportIncidentScreen from './src/screens/ReportIncidentScreen';
import OBEntryScreen from './src/screens/OBEntryScreen';
import { Shield, Users, Car, AlertTriangle, BookOpen, LogOut } from 'lucide-react-native';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Stack for patrols (allows detail navigation)
function PatrolsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PatrolsList" component={PatrolsScreen} />
      <Stack.Screen name="PatrolDetail" component={PatrolDetailScreen} />
    </Stack.Navigator>
  );
}

// Main tab navigator
function MainTabs() {
  const { logout } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let IconComponent;
          switch (route.name) {
            case 'Patrols':
              IconComponent = Shield;
              break;
            case 'Person':
              IconComponent = Users;
              break;
            case 'Vehicle':
              IconComponent = Car;
              break;
            case 'Incident':
              IconComponent = AlertTriangle;
              break;
            case 'OBEntry':
              IconComponent = BookOpen;
              break;
            default:
              IconComponent = Shield;
          }
          return <IconComponent size={size} color={color} />;
        },
        tabBarActiveTintColor: '#dc2626',
        tabBarInactiveTintColor: '#666',
        tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#1f1f1f' },
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerRight: () => (
          <TouchableOpacity onPress={logout} style={{ marginRight: 15 }}>
            <LogOut size={22} color="#dc2626" />
          </TouchableOpacity>
        ),
      })}
    >
      <Tab.Screen name="Patrols" component={PatrolsStack} options={{ title: 'Patrols' }} />
      <Tab.Screen name="Person" component={RegisterPedestrianScreen} options={{ title: 'Register Person' }} />
      <Tab.Screen name="Vehicle" component={RegisterVehicleScreen} options={{ title: 'Register Vehicle' }} />
      <Tab.Screen name="Incident" component={ReportIncidentScreen} options={{ title: 'Report Incident' }} />
      <Tab.Screen name="OBEntry" component={OBEntryScreen} options={{ title: 'OB Entry' }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // optionally show a splash screen
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <Stack.Screen name="Main" component={MainTabs} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}