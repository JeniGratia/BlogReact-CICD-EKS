pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 60, unit: 'MINUTES')
    }

    triggers {
        pollSCM('H/5 * * * *')
    }

    environment {
        AWS_REGION            = '<region>'
        AWS_DEFAULT_REGION    = '<region>'
        AWS_ACCOUNT_ID        = '<account-id>'
        EKS_CLUSTER           = '<cluster-name>'
        APP_NAMESPACE         = 'blogapp'
        BACKEND_DEPLOY        = 'backend'
        FRONTEND_DEPLOY       = 'frontend'

        ECR_REGISTRY          = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        BACKEND_REPO          = '<ecr-backend-repo-name>'
        FRONTEND_REPO         = '<ecr-frontend-repo-name>'
        IMAGE_TAG             = "build-${BUILD_NUMBER}"
        NODE_IMAGE            = 'node:20-alpine'
        KUBECONFIG            = '/var/jenkins_home/.kube/config'

        SONAR_HOST_URL        = '<http://sonarqube-host:9000>'
        SONAR_PROJECT_KEY     = 'blogreact'
        SONAR_DOCKER_NETWORK  = 'bridge'

        AWS_ACCESS_KEY_ID     = credentials('aws-access-key-id')
        AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
        SONAR_TOKEN           = credentials('sonar-token')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu
                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")
                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        CID=$(docker create -w /app "$NODE_IMAGE" \
                          sh -ec "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")
                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('SonarQube Analysis and Quality Gate') {
            steps {
                sh '''
                    set -eu
                    CID=$(docker create --network "$SONAR_DOCKER_NETWORK" \
                      -e SONAR_TOKEN="$SONAR_TOKEN" \
                      -w /usr/src \
                      sonarsource/sonar-scanner-cli:latest \
                      sonar-scanner \
                        -Dsonar.projectKey="$SONAR_PROJECT_KEY" \
                        -Dsonar.host.url="$SONAR_HOST_URL" \
                        -Dsonar.sources=backend/src,frontend/src \
                        -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/tests/**" \
                        -Dsonar.qualitygate.wait=true \
                        -Dsonar.qualitygate.timeout=300)
                    trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
                    docker cp . "$CID":/usr/src
                    docker start -a "$CID"
                '''
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                    set -eu
                    docker build --platform linux/amd64 --provenance=false \
                      -t "$ECR_REGISTRY/$BACKEND_REPO:$IMAGE_TAG" ./backend
                    docker build --platform linux/amd64 --provenance=false \
                      -t "$ECR_REGISTRY/$FRONTEND_REPO:$IMAGE_TAG" ./frontend
                '''
            }
        }

        stage('Trivy Image Scan') {
            steps {
                sh '''
                    set -eu
                    for img in "$ECR_REGISTRY/$BACKEND_REPO:$IMAGE_TAG" \
                               "$ECR_REGISTRY/$FRONTEND_REPO:$IMAGE_TAG"; do
                      echo "Scanning $img"
                      docker run --rm \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        -v trivy-cache:/root/.cache/ \
                        aquasec/trivy:latest image \
                        --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        --ignore-unfixed \
                        --no-progress \
                        "$img"
                    done
                '''
            }
        }

        stage('Push Images to ECR') {
            steps {
                sh '''
                    set -eu
                    aws sts get-caller-identity
                    aws ecr get-login-password --region "$AWS_REGION" | \
                      docker login --username AWS --password-stdin "$ECR_REGISTRY"

                    docker push "$ECR_REGISTRY/$BACKEND_REPO:$IMAGE_TAG"
                    docker push "$ECR_REGISTRY/$FRONTEND_REPO:$IMAGE_TAG"
                '''
            }
        }

        stage('Connect to EKS') {
            steps {
                sh '''
                    set -eu
                    aws eks update-kubeconfig --name "$EKS_CLUSTER" --region "$AWS_REGION"
                    kubectl get nodes
                    kubectl get deploy -n "$APP_NAMESPACE" -o wide
                '''
            }
        }

        stage('Deploy to EKS') {
            steps {
                sh '''
                    set -eu

                    kubectl set image deployment/"$BACKEND_DEPLOY" \
                      '*='"$ECR_REGISTRY/$BACKEND_REPO:$IMAGE_TAG" -n "$APP_NAMESPACE"
                    kubectl set image deployment/"$FRONTEND_DEPLOY" \
                      '*='"$ECR_REGISTRY/$FRONTEND_REPO:$IMAGE_TAG" -n "$APP_NAMESPACE"

                    kubectl rollout status deployment/"$BACKEND_DEPLOY" \
                      -n "$APP_NAMESPACE" --timeout=300s || {
                        echo "Backend rollout failed, rolling back"
                        kubectl rollout undo deployment/"$BACKEND_DEPLOY" -n "$APP_NAMESPACE"
                        exit 1
                      }

                    kubectl rollout status deployment/"$FRONTEND_DEPLOY" \
                      -n "$APP_NAMESPACE" --timeout=300s || {
                        echo "Frontend rollout failed, rolling back"
                        kubectl rollout undo deployment/"$FRONTEND_DEPLOY" -n "$APP_NAMESPACE"
                        exit 1
                      }

                    echo "Images now running:"
                    kubectl get deploy -n "$APP_NAMESPACE" \
                      -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -eu
                    POD="jenkins-smoke-${BUILD_NUMBER}"
                    trap 'kubectl delete pod "$POD" -n "$APP_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true' EXIT

                    kubectl run "$POD" -n "$APP_NAMESPACE" \
                      --image=curlimages/curl:8.12.1 \
                      --restart=Never \
                      --command -- \
                      curl --fail --silent --show-error \
                      --retry 10 --retry-connrefused --retry-delay 2 \
                      http://frontend-service/api/healthz

                    kubectl wait --for=jsonpath='{.status.phase}'=Succeeded \
                      pod/"$POD" -n "$APP_NAMESPACE" --timeout=180s \
                      || { kubectl logs "$POD" -n "$APP_NAMESPACE" || true; exit 1; }

                    kubectl logs "$POD" -n "$APP_NAMESPACE"
                '''
            }
        }
    }

    post {
        success { echo "Deployed ${IMAGE_TAG} to EKS and smoke test passed." }
        failure { echo 'Pipeline failed. Check the first failing stage.' }
        always  { echo 'Pipeline finished.' }
    }
}

