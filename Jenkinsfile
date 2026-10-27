
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAMESPACE = 'blogapp'
        BACKEND_IMAGE = 'blogreact-backend:local'
        FRONTEND_IMAGE = 'blogreact-frontend:local'
        NODE_IMAGE = 'node:20-alpine'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git status --short'
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        docker run --rm \
                          -v "$PWD:/app" \
                          -w /app \
                          "$NODE_IMAGE" sh -lc \
                          "npm ci && npm test && npm run lint"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        docker run --rm \
                          -v "$PWD:/app" \
                          -w /app \
                          "$NODE_IMAGE" sh -lc \
                          "npm ci && npm run lint && npm run build"
                    '''
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    docker build -t "$BACKEND_IMAGE" ./backend
                    docker build -t "$FRONTEND_IMAGE" ./frontend

                    kind load docker-image "$BACKEND_IMAGE" \
                      --name blog-project
                    kind load docker-image "$FRONTEND_IMAGE" \
                      --name blog-project
                '''
            }
        }

        stage('Validate Kubernetes Manifests') {
            steps {
                sh '''
                    kubectl apply --dry-run=client \
                      -f k8s/backend/deployment.yaml
                    kubectl apply --dry-run=client \
                      -f k8s/backend/service.yaml
                    kubectl apply --dry-run=client \
                      -f k8s/frontend/deployment.yaml
                    kubectl apply --dry-run=client \
                      -f k8s/frontend/service.yaml
                '''
            }
        }

        stage('Deploy to Local Kubernetes') {
            steps {
                sh '''
                    set -eu

                    kubectl apply -f k8s/backend/deployment.yaml
                    kubectl apply -f k8s/backend/service.yaml
                    kubectl apply -f k8s/frontend/deployment.yaml
                    kubectl apply -f k8s/frontend/service.yaml

                    kubectl rollout status deployment/backend \
                      -n "$APP_NAMESPACE" --timeout=180s
                    kubectl rollout status deployment/frontend \
                      -n "$APP_NAMESPACE" --timeout=180s
                '''
            }
        }

        stage('Automated Deployment Validation') {
            steps {
                sh '''
                    set -eu

                    kubectl wait --for=condition=Available \
                      deployment/backend -n "$APP_NAMESPACE" \
                      --timeout=120s
                    kubectl wait --for=condition=Available \
                      deployment/frontend -n "$APP_NAMESPACE" \
                      --timeout=120s

                    kubectl run "jenkins-smoke-${BUILD_NUMBER}" \
                      -n "$APP_NAMESPACE" \
                      --image=curlimages/curl:8.12.1 \
                      --restart=Never \
                      --rm -i --quiet \
                      --command -- \
                      curl --fail --silent --show-error \
                      --retry 10 --retry-connrefused \
                      --retry-delay 2 \
                      http://frontend-service/api/healthz

                    echo "Deployment validation passed."
                '''
            }
        }
    }

    post {
        success {
            echo 'CI pipeline and deployment validation succeeded.'
        }
        failure {
            echo 'Pipeline failed. Review the first failing stage.'
        }
        always {
            echo 'Pipeline execution finished.'
        }
    }
}
